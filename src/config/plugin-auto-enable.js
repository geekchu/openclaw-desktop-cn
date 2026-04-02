import fs from "node:fs";
import path from "node:path";
import { normalizeProviderId } from "../agents/model-selection.js";
import { getChatChannelMeta, listChatChannels, normalizeChatChannelId, } from "../channels/registry.js";
import { BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS, BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS, } from "../plugins/bundled-capability-metadata.js";
import { loadPluginManifestRegistry, } from "../plugins/manifest-registry.js";
import { isRecord, resolveConfigDir, resolveUserPath } from "../utils.js";
import { isChannelConfigured } from "./channel-configured.js";
import { ensurePluginAllowlisted } from "./plugins-allowlist.js";
const EMPTY_PLUGIN_MANIFEST_REGISTRY = {
    plugins: [],
    diagnostics: [],
};
const ENV_CATALOG_PATHS = ["OPENCLAW_PLUGIN_CATALOG_PATHS", "OPENCLAW_MPM_CATALOG_PATHS"];
function resolveAutoEnableProviderPluginIds(registry) {
    const entries = new Map(Object.entries(BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS));
    for (const plugin of registry.plugins) {
        for (const providerId of plugin.autoEnableWhenConfiguredProviders ?? []) {
            if (!entries.has(providerId)) {
                entries.set(providerId, plugin.id);
            }
        }
    }
    return Object.fromEntries(entries);
}
function collectModelRefs(cfg) {
    const refs = [];
    const pushModelRef = (value) => {
        if (typeof value === "string" && value.trim()) {
            refs.push(value.trim());
        }
    };
    const collectFromAgent = (agent) => {
        if (!agent) {
            return;
        }
        const model = agent.model;
        if (typeof model === "string") {
            pushModelRef(model);
        }
        else if (isRecord(model)) {
            pushModelRef(model.primary);
            const fallbacks = model.fallbacks;
            if (Array.isArray(fallbacks)) {
                for (const entry of fallbacks) {
                    pushModelRef(entry);
                }
            }
        }
        const models = agent.models;
        if (isRecord(models)) {
            for (const key of Object.keys(models)) {
                pushModelRef(key);
            }
        }
    };
    const defaults = cfg.agents?.defaults;
    collectFromAgent(defaults);
    const list = cfg.agents?.list;
    if (Array.isArray(list)) {
        for (const entry of list) {
            if (isRecord(entry)) {
                collectFromAgent(entry);
            }
        }
    }
    return refs;
}
function extractProviderFromModelRef(value) {
    const trimmed = value.trim();
    const slash = trimmed.indexOf("/");
    if (slash <= 0) {
        return null;
    }
    return normalizeProviderId(trimmed.slice(0, slash));
}
function isProviderConfigured(cfg, providerId) {
    const normalized = normalizeProviderId(providerId);
    const profiles = cfg.auth?.profiles;
    if (profiles && typeof profiles === "object") {
        for (const profile of Object.values(profiles)) {
            if (!isRecord(profile)) {
                continue;
            }
            const provider = normalizeProviderId(String(profile.provider ?? ""));
            if (provider === normalized) {
                return true;
            }
        }
    }
    const providerConfig = cfg.models?.providers;
    if (providerConfig && typeof providerConfig === "object") {
        for (const key of Object.keys(providerConfig)) {
            if (normalizeProviderId(key) === normalized) {
                return true;
            }
        }
    }
    const modelRefs = collectModelRefs(cfg);
    for (const ref of modelRefs) {
        const provider = extractProviderFromModelRef(ref);
        if (provider && provider === normalized) {
            return true;
        }
    }
    return false;
}
function hasPluginOwnedWebSearchConfig(cfg, pluginId) {
    const pluginConfig = cfg.plugins?.entries?.[pluginId]?.config;
    if (!isRecord(pluginConfig)) {
        return false;
    }
    return isRecord(pluginConfig.webSearch);
}
function hasPluginOwnedToolConfig(cfg, pluginId) {
    if (pluginId === "xai") {
        const pluginConfig = cfg.plugins?.entries?.xai?.config;
        return Boolean(isRecord(cfg.tools?.web?.x_search) ||
            (isRecord(pluginConfig) && isRecord(pluginConfig.codeExecution)));
    }
    return false;
}
function resolveProviderPluginsWithOwnedWebSearch(registry) {
    const pluginIds = new Set(BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.filter((entry) => entry.providerIds.length > 0 && entry.webSearchProviderIds.length > 0).map((entry) => entry.pluginId));
    for (const plugin of registry.plugins) {
        if (plugin.providers.length > 0 && (plugin.contracts?.webSearchProviders?.length ?? 0) > 0) {
            pluginIds.add(plugin.id);
        }
    }
    return pluginIds;
}
function buildChannelToPluginIdMap(registry) {
    const map = new Map();
    for (const record of registry.plugins) {
        for (const channelId of record.channels) {
            if (channelId && !map.has(channelId)) {
                map.set(channelId, record.id);
            }
        }
    }
    return map;
}
function splitEnvPaths(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }
    return trimmed
        .split(/[;,]/g)
        .flatMap((chunk) => chunk.split(path.delimiter))
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function resolveExternalCatalogPaths(env) {
    for (const key of ENV_CATALOG_PATHS) {
        const raw = env[key];
        if (raw && raw.trim()) {
            return splitEnvPaths(raw);
        }
    }
    const configDir = resolveConfigDir(env);
    return [
        path.join(configDir, "mpm", "plugins.json"),
        path.join(configDir, "mpm", "catalog.json"),
        path.join(configDir, "plugins", "catalog.json"),
    ];
}
function parseExternalCatalogChannelEntries(raw) {
    const list = (() => {
        if (Array.isArray(raw)) {
            return raw;
        }
        if (!isRecord(raw)) {
            return [];
        }
        const entries = raw.entries ?? raw.packages ?? raw.plugins;
        return Array.isArray(entries) ? entries : [];
    })();
    const channels = [];
    for (const entry of list) {
        if (!isRecord(entry) || !isRecord(entry.openclaw) || !isRecord(entry.openclaw.channel)) {
            continue;
        }
        const channel = entry.openclaw.channel;
        const id = typeof channel.id === "string" ? channel.id.trim() : "";
        if (!id) {
            continue;
        }
        const preferOver = Array.isArray(channel.preferOver)
            ? channel.preferOver.filter((value) => typeof value === "string")
            : [];
        channels.push({ id, preferOver });
    }
    return channels;
}
function resolveExternalCatalogPreferOver(channelId, env) {
    for (const rawPath of resolveExternalCatalogPaths(env)) {
        const resolved = resolveUserPath(rawPath, env);
        if (!fs.existsSync(resolved)) {
            continue;
        }
        try {
            const payload = JSON.parse(fs.readFileSync(resolved, "utf-8"));
            const channel = parseExternalCatalogChannelEntries(payload).find((entry) => entry.id === channelId);
            if (channel) {
                return channel.preferOver;
            }
        }
        catch {
            // Ignore invalid catalog files.
        }
    }
    return [];
}
function resolvePluginIdForChannel(channelId, channelToPluginId) {
    // Third-party plugins can expose a channel id that differs from their
    // manifest id; plugins.entries must always be keyed by manifest id.
    const builtInId = normalizeChatChannelId(channelId);
    if (builtInId) {
        return builtInId;
    }
    return channelToPluginId.get(channelId) ?? channelId;
}
function listKnownChannelPluginIds() {
    return listChatChannels().map((meta) => meta.id);
}
function collectCandidateChannelIds(cfg) {
    const channelIds = new Set(listKnownChannelPluginIds());
    const configuredChannels = cfg.channels;
    if (!configuredChannels || typeof configuredChannels !== "object") {
        return Array.from(channelIds);
    }
    for (const key of Object.keys(configuredChannels)) {
        if (key === "defaults" || key === "modelByChannel") {
            continue;
        }
        const normalizedBuiltIn = normalizeChatChannelId(key);
        channelIds.add(normalizedBuiltIn ?? key);
    }
    return Array.from(channelIds);
}
function configMayNeedPluginManifestRegistry(cfg) {
    const configuredChannels = cfg.channels;
    if (!configuredChannels || typeof configuredChannels !== "object") {
        return false;
    }
    for (const key of Object.keys(configuredChannels)) {
        if (key === "defaults" || key === "modelByChannel") {
            continue;
        }
        if (!normalizeChatChannelId(key)) {
            return true;
        }
    }
    return false;
}
function resolveConfiguredPlugins(cfg, env, registry) {
    const changes = [];
    // Build reverse map: channel ID → plugin ID from installed plugin manifests.
    const channelToPluginId = buildChannelToPluginIdMap(registry);
    for (const channelId of collectCandidateChannelIds(cfg)) {
        const pluginId = resolvePluginIdForChannel(channelId, channelToPluginId);
        if (isChannelConfigured(cfg, channelId, env)) {
            changes.push({ pluginId, reason: `${channelId} configured` });
        }
    }
    for (const [providerId, pluginId] of Object.entries(resolveAutoEnableProviderPluginIds(registry))) {
        if (isProviderConfigured(cfg, providerId)) {
            changes.push({
                pluginId,
                reason: `${providerId} auth configured`,
            });
        }
    }
    for (const pluginId of resolveProviderPluginsWithOwnedWebSearch(registry)) {
        if (hasPluginOwnedWebSearchConfig(cfg, pluginId)) {
            changes.push({
                pluginId,
                reason: `${pluginId} web search configured`,
            });
        }
    }
    for (const pluginId of resolveProviderPluginsWithOwnedWebSearch(registry)) {
        if (hasPluginOwnedToolConfig(cfg, pluginId)) {
            changes.push({
                pluginId,
                reason: `${pluginId} tool configured`,
            });
        }
    }
    const backendRaw = typeof cfg.acp?.backend === "string" ? cfg.acp.backend.trim().toLowerCase() : "";
    const acpConfigured = cfg.acp?.enabled === true || cfg.acp?.dispatch?.enabled === true || backendRaw === "acpx";
    if (acpConfigured && (!backendRaw || backendRaw === "acpx")) {
        changes.push({
            pluginId: "acpx",
            reason: "ACP runtime configured",
        });
    }
    return changes;
}
function isPluginExplicitlyDisabled(cfg, pluginId) {
    const builtInChannelId = normalizeChatChannelId(pluginId);
    if (builtInChannelId) {
        const channels = cfg.channels;
        const channelConfig = channels?.[builtInChannelId];
        if (channelConfig &&
            typeof channelConfig === "object" &&
            !Array.isArray(channelConfig) &&
            channelConfig.enabled === false) {
            return true;
        }
    }
    const entry = cfg.plugins?.entries?.[pluginId];
    return entry?.enabled === false;
}
function isPluginDenied(cfg, pluginId) {
    const deny = cfg.plugins?.deny;
    return Array.isArray(deny) && deny.includes(pluginId);
}
function resolvePreferredOverIds(pluginId, env, registry) {
    const normalized = normalizeChatChannelId(pluginId);
    if (normalized) {
        return [...(getChatChannelMeta(normalized).preferOver ?? [])];
    }
    const installedPlugin = registry.plugins.find((record) => record.id === pluginId);
    const manifestChannelPreferOver = installedPlugin?.channelConfigs?.[pluginId]?.preferOver;
    if (manifestChannelPreferOver?.length) {
        return [...manifestChannelPreferOver];
    }
    const installedChannelMeta = installedPlugin?.channelCatalogMeta;
    if (installedChannelMeta?.preferOver?.length) {
        return [...installedChannelMeta.preferOver];
    }
    return resolveExternalCatalogPreferOver(pluginId, env);
}
function shouldSkipPreferredPluginAutoEnable(cfg, entry, configured, env, registry) {
    for (const other of configured) {
        if (other.pluginId === entry.pluginId) {
            continue;
        }
        if (isPluginDenied(cfg, other.pluginId)) {
            continue;
        }
        if (isPluginExplicitlyDisabled(cfg, other.pluginId)) {
            continue;
        }
        const preferOver = resolvePreferredOverIds(other.pluginId, env, registry);
        if (preferOver.includes(entry.pluginId)) {
            return true;
        }
    }
    return false;
}
function registerPluginEntry(cfg, pluginId) {
    const builtInChannelId = normalizeChatChannelId(pluginId);
    if (builtInChannelId) {
        const channels = cfg.channels;
        const existing = channels?.[builtInChannelId];
        const existingRecord = existing && typeof existing === "object" && !Array.isArray(existing)
            ? existing
            : {};
        return {
            ...cfg,
            channels: {
                ...cfg.channels,
                [builtInChannelId]: {
                    ...existingRecord,
                    enabled: true,
                },
            },
        };
    }
    const entries = {
        ...cfg.plugins?.entries,
        [pluginId]: {
            ...cfg.plugins?.entries?.[pluginId],
            enabled: true,
        },
    };
    return {
        ...cfg,
        plugins: {
            ...cfg.plugins,
            entries,
        },
    };
}
function formatAutoEnableChange(entry) {
    let reason = entry.reason.trim();
    const channelId = normalizeChatChannelId(entry.pluginId);
    if (channelId) {
        const label = getChatChannelMeta(channelId).label;
        reason = reason.replace(new RegExp(`^${channelId}\\b`, "i"), label);
    }
    return `${reason}, enabled automatically.`;
}
export function applyPluginAutoEnable(params) {
    const env = params.env ?? process.env;
    const registry = params.manifestRegistry ??
        (configMayNeedPluginManifestRegistry(params.config)
            ? loadPluginManifestRegistry({ config: params.config, env })
            : EMPTY_PLUGIN_MANIFEST_REGISTRY);
    const configured = resolveConfiguredPlugins(params.config, env, registry);
    if (configured.length === 0) {
        return { config: params.config, changes: [] };
    }
    let next = params.config;
    const changes = [];
    if (next.plugins?.enabled === false) {
        return { config: next, changes };
    }
    for (const entry of configured) {
        const builtInChannelId = normalizeChatChannelId(entry.pluginId);
        if (isPluginDenied(next, entry.pluginId)) {
            continue;
        }
        if (isPluginExplicitlyDisabled(next, entry.pluginId)) {
            continue;
        }
        if (shouldSkipPreferredPluginAutoEnable(next, entry, configured, env, registry)) {
            continue;
        }
        const allow = next.plugins?.allow;
        const allowMissing = builtInChannelId == null && Array.isArray(allow) && !allow.includes(entry.pluginId);
        const alreadyEnabled = builtInChannelId != null
            ? (() => {
                const channels = next.channels;
                const channelConfig = channels?.[builtInChannelId];
                if (!channelConfig ||
                    typeof channelConfig !== "object" ||
                    Array.isArray(channelConfig)) {
                    return false;
                }
                return channelConfig.enabled === true;
            })()
            : next.plugins?.entries?.[entry.pluginId]?.enabled === true;
        if (alreadyEnabled && !allowMissing) {
            continue;
        }
        next = registerPluginEntry(next, entry.pluginId);
        if (!builtInChannelId) {
            next = ensurePluginAllowlisted(next, entry.pluginId);
        }
        changes.push(formatAutoEnableChange(entry));
    }
    return { config: next, changes };
}
