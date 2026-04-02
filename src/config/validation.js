import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { CHANNEL_IDS, normalizeChatChannelId } from "../channels/registry.js";
import { withBundledPluginAllowlistCompat } from "../plugins/bundled-compat.js";
import { listBundledWebSearchPluginIds } from "../plugins/bundled-web-search-ids.js";
import { normalizePluginsConfig, resolveEffectiveEnableState, resolveMemorySlotDecision, } from "../plugins/config-state.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { validateJsonSchemaValue } from "../plugins/schema-validator.js";
import { hasAvatarUriScheme, isAvatarDataUrl, isAvatarHttpUrl, isPathWithinRoot, isWindowsAbsolutePath, } from "../shared/avatar-policy.js";
import { isCanonicalDottedDecimalIPv4, isLoopbackIpAddress } from "../shared/net/ip.js";
import { isRecord } from "../utils.js";
import { findDuplicateAgentDirs, formatDuplicateAgentDirError } from "./agent-dirs.js";
import { appendAllowedValuesHint, summarizeAllowedValues } from "./allowed-values.js";
import { getBundledChannelConfigSchemaMap } from "./bundled-channel-config-runtime.js";
import { collectChannelSchemaMetadata } from "./channel-config-metadata.js";
import { applyAgentDefaults, applyModelDefaults, applySessionDefaults } from "./defaults.js";
import { listLegacyWebSearchConfigPaths, normalizeLegacyWebSearchConfig, } from "./legacy-web-search.js";
import { findLegacyConfigIssues } from "./legacy.js";
import { OpenClawSchema } from "./zod-schema.js";
const LEGACY_REMOVED_PLUGIN_IDS = new Set(["google-antigravity-auth", "google-gemini-cli-auth"]);
const CUSTOM_EXPECTED_ONE_OF_RE = /expected one of ((?:"[^"]+"(?:\|"?[^"]+"?)*)+)/i;
function toIssueRecord(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    return value;
}
function toConfigPathSegments(path) {
    if (!Array.isArray(path)) {
        return [];
    }
    return path.filter((segment) => {
        const segmentType = typeof segment;
        return segmentType === "string" || segmentType === "number";
    });
}
function formatConfigPath(segments) {
    return segments.join(".");
}
function toJsonSchemaNode(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
}
function getSchemaCombinatorBranches(node) {
    const keys = ["anyOf", "oneOf", "allOf"];
    const branches = [];
    for (const key of keys) {
        const value = node[key];
        if (!Array.isArray(value)) {
            continue;
        }
        for (const entry of value) {
            const child = toJsonSchemaNode(entry);
            if (child) {
                branches.push(child);
            }
        }
    }
    return branches;
}
function collectAllowedValuesFromSchemaNode(node) {
    if (Object.prototype.hasOwnProperty.call(node, "const")) {
        return { values: [node.const], incomplete: false, hasValues: true };
    }
    const enumValues = node.enum;
    if (Array.isArray(enumValues)) {
        return { values: enumValues, incomplete: false, hasValues: enumValues.length > 0 };
    }
    if (node.type === "boolean") {
        return { values: [true, false], incomplete: false, hasValues: true };
    }
    const branches = getSchemaCombinatorBranches(node);
    if (branches.length === 0) {
        return { values: [], incomplete: true, hasValues: false };
    }
    const collected = [];
    for (const branch of branches) {
        const result = collectAllowedValuesFromSchemaNode(branch);
        if (result.incomplete || !result.hasValues) {
            return { values: [], incomplete: true, hasValues: false };
        }
        collected.push(...result.values);
    }
    return { values: collected, incomplete: false, hasValues: collected.length > 0 };
}
function advanceSchemaNodes(node, segment) {
    const branches = getSchemaCombinatorBranches(node);
    if (branches.length > 0) {
        return branches.flatMap((branch) => advanceSchemaNodes(branch, segment));
    }
    if (typeof segment === "number") {
        const items = toJsonSchemaNode(node.items);
        return items ? [items] : [];
    }
    const properties = toJsonSchemaNode(node.properties);
    const propertyNode = properties ? toJsonSchemaNode(properties[segment]) : null;
    if (propertyNode) {
        return [propertyNode];
    }
    const additionalProperties = toJsonSchemaNode(node.additionalProperties);
    return additionalProperties ? [additionalProperties] : [];
}
function collectAllowedValuesFromSchemaPath(root, path) {
    let currentNodes = [root];
    for (const segment of path) {
        currentNodes = currentNodes.flatMap((node) => advanceSchemaNodes(node, segment));
        if (currentNodes.length === 0) {
            return { values: [], incomplete: false, hasValues: false };
        }
    }
    const collected = [];
    for (const node of currentNodes) {
        const result = collectAllowedValuesFromSchemaNode(node);
        if (result.incomplete || !result.hasValues) {
            return { values: [], incomplete: true, hasValues: false };
        }
        collected.push(...result.values);
    }
    return { values: collected, incomplete: false, hasValues: collected.length > 0 };
}
function collectAllowedValuesFromConfigPath(path) {
    if (path[0] === "channels" && typeof path[1] === "string") {
        const channelSchema = getBundledChannelConfigSchemaMap().get(path[1]);
        const schemaRoot = toJsonSchemaNode(channelSchema?.schema);
        if (schemaRoot) {
            return collectAllowedValuesFromSchemaPath(schemaRoot, path.slice(2));
        }
    }
    return { values: [], incomplete: false, hasValues: false };
}
function collectAllowedValuesFromCustomIssue(record) {
    const path = toConfigPathSegments(record.path);
    const schemaValues = collectAllowedValuesFromConfigPath(path);
    if (schemaValues.hasValues && !schemaValues.incomplete) {
        return schemaValues;
    }
    const message = typeof record.message === "string" ? record.message : "";
    const expectedMatch = message.match(CUSTOM_EXPECTED_ONE_OF_RE);
    if (expectedMatch?.[1]) {
        const values = [...expectedMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
        return { values, incomplete: false, hasValues: values.length > 0 };
    }
    return { values: [], incomplete: false, hasValues: false };
}
function collectAllowedValuesFromIssue(issue) {
    const record = toIssueRecord(issue);
    if (!record) {
        return { values: [], incomplete: false, hasValues: false };
    }
    const code = typeof record.code === "string" ? record.code : "";
    if (code === "invalid_value") {
        const values = record.values;
        if (!Array.isArray(values)) {
            return { values: [], incomplete: true, hasValues: false };
        }
        return { values, incomplete: false, hasValues: values.length > 0 };
    }
    if (code === "invalid_type") {
        const expected = typeof record.expected === "string" ? record.expected : "";
        if (expected === "boolean") {
            return { values: [true, false], incomplete: false, hasValues: true };
        }
        return { values: [], incomplete: true, hasValues: false };
    }
    if (code === "custom") {
        return collectAllowedValuesFromCustomIssue(record);
    }
    if (code !== "invalid_union") {
        return { values: [], incomplete: false, hasValues: false };
    }
    const nested = record.errors;
    if (!Array.isArray(nested) || nested.length === 0) {
        return { values: [], incomplete: true, hasValues: false };
    }
    const collected = [];
    for (const branch of nested) {
        if (!Array.isArray(branch) || branch.length === 0) {
            return { values: [], incomplete: true, hasValues: false };
        }
        const branchCollected = collectAllowedValuesFromIssueList(branch);
        if (branchCollected.incomplete || !branchCollected.hasValues) {
            return { values: [], incomplete: true, hasValues: false };
        }
        collected.push(...branchCollected.values);
    }
    return { values: collected, incomplete: false, hasValues: collected.length > 0 };
}
function collectAllowedValuesFromIssueList(issues) {
    const collected = [];
    let hasValues = false;
    for (const issue of issues) {
        const branch = collectAllowedValuesFromIssue(issue);
        if (branch.incomplete) {
            return { values: [], incomplete: true, hasValues: false };
        }
        if (!branch.hasValues) {
            continue;
        }
        hasValues = true;
        collected.push(...branch.values);
    }
    return { values: collected, incomplete: false, hasValues };
}
function collectAllowedValuesFromUnknownIssue(issue) {
    const collection = collectAllowedValuesFromIssue(issue);
    if (collection.incomplete || !collection.hasValues) {
        return [];
    }
    return collection.values;
}
function mapZodIssueToConfigIssue(issue) {
    const record = toIssueRecord(issue);
    const path = formatConfigPath(toConfigPathSegments(record?.path));
    const message = typeof record?.message === "string" ? record.message : "Invalid input";
    const allowedValuesSummary = summarizeAllowedValues(collectAllowedValuesFromUnknownIssue(issue));
    if (!allowedValuesSummary) {
        return { path, message };
    }
    return {
        path,
        message: appendAllowedValuesHint(message, allowedValuesSummary),
        allowedValues: allowedValuesSummary.values,
        allowedValuesHiddenCount: allowedValuesSummary.hiddenCount,
    };
}
function isWorkspaceAvatarPath(value, workspaceDir) {
    const workspaceRoot = path.resolve(workspaceDir);
    const resolved = path.resolve(workspaceRoot, value);
    return isPathWithinRoot(workspaceRoot, resolved);
}
function validateIdentityAvatar(config) {
    const agents = config.agents?.list;
    if (!Array.isArray(agents) || agents.length === 0) {
        return [];
    }
    const issues = [];
    for (const [index, entry] of agents.entries()) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const avatarRaw = entry.identity?.avatar;
        if (typeof avatarRaw !== "string") {
            continue;
        }
        const avatar = avatarRaw.trim();
        if (!avatar) {
            continue;
        }
        if (isAvatarDataUrl(avatar) || isAvatarHttpUrl(avatar)) {
            continue;
        }
        if (avatar.startsWith("~")) {
            issues.push({
                path: `agents.list.${index}.identity.avatar`,
                message: "identity.avatar must be a workspace-relative path, http(s) URL, or data URI.",
            });
            continue;
        }
        const hasScheme = hasAvatarUriScheme(avatar);
        if (hasScheme && !isWindowsAbsolutePath(avatar)) {
            issues.push({
                path: `agents.list.${index}.identity.avatar`,
                message: "identity.avatar must be a workspace-relative path, http(s) URL, or data URI.",
            });
            continue;
        }
        const workspaceDir = resolveAgentWorkspaceDir(config, entry.id ?? resolveDefaultAgentId(config));
        if (!isWorkspaceAvatarPath(avatar, workspaceDir)) {
            issues.push({
                path: `agents.list.${index}.identity.avatar`,
                message: "identity.avatar must stay within the agent workspace.",
            });
        }
    }
    return issues;
}
function validateGatewayTailscaleBind(config) {
    const tailscaleMode = config.gateway?.tailscale?.mode ?? "off";
    if (tailscaleMode !== "serve" && tailscaleMode !== "funnel") {
        return [];
    }
    const bindMode = config.gateway?.bind ?? "loopback";
    if (bindMode === "loopback") {
        return [];
    }
    const customBindHost = config.gateway?.customBindHost;
    if (bindMode === "custom" &&
        isCanonicalDottedDecimalIPv4(customBindHost) &&
        isLoopbackIpAddress(customBindHost)) {
        return [];
    }
    return [
        {
            path: "gateway.bind",
            message: `gateway.bind must resolve to loopback when gateway.tailscale.mode=${tailscaleMode} ` +
                '(use gateway.bind="loopback" or gateway.bind="custom" with gateway.customBindHost="127.0.0.1")',
        },
    ];
}
/**
 * Validates config without applying runtime defaults.
 * Use this when you need the raw validated config (e.g., for writing back to file).
 */
export function validateConfigObjectRaw(raw) {
    const normalizedRaw = normalizeLegacyWebSearchConfig(raw);
    const legacyIssues = findLegacyConfigIssues(normalizedRaw);
    if (legacyIssues.length > 0) {
        return {
            ok: false,
            issues: legacyIssues.map((iss) => ({
                path: iss.path,
                message: iss.message,
            })),
        };
    }
    const validated = OpenClawSchema.safeParse(normalizedRaw);
    if (!validated.success) {
        return {
            ok: false,
            issues: validated.error.issues.map((issue) => mapZodIssueToConfigIssue(issue)),
        };
    }
    const validatedConfig = validated.data;
    const duplicates = findDuplicateAgentDirs(validatedConfig);
    if (duplicates.length > 0) {
        return {
            ok: false,
            issues: [
                {
                    path: "agents.list",
                    message: formatDuplicateAgentDirError(duplicates),
                },
            ],
        };
    }
    const avatarIssues = validateIdentityAvatar(validatedConfig);
    if (avatarIssues.length > 0) {
        return { ok: false, issues: avatarIssues };
    }
    const gatewayTailscaleBindIssues = validateGatewayTailscaleBind(validatedConfig);
    if (gatewayTailscaleBindIssues.length > 0) {
        return { ok: false, issues: gatewayTailscaleBindIssues };
    }
    return {
        ok: true,
        config: validatedConfig,
    };
}
export function validateConfigObject(raw) {
    const result = validateConfigObjectRaw(raw);
    if (!result.ok) {
        return result;
    }
    return {
        ok: true,
        config: applyModelDefaults(applyAgentDefaults(applySessionDefaults(result.config))),
    };
}
export function validateConfigObjectWithPlugins(raw, params) {
    return validateConfigObjectWithPluginsBase(raw, { applyDefaults: true, env: params?.env });
}
export function validateConfigObjectRawWithPlugins(raw, params) {
    return validateConfigObjectWithPluginsBase(raw, { applyDefaults: false, env: params?.env });
}
function validateConfigObjectWithPluginsBase(raw, opts) {
    const base = opts.applyDefaults ? validateConfigObject(raw) : validateConfigObjectRaw(raw);
    if (!base.ok) {
        return { ok: false, issues: base.issues, warnings: [] };
    }
    const config = base.config;
    const issues = [];
    const warnings = listLegacyWebSearchConfigPaths(raw).map((path) => ({
        path,
        message: `${path} is deprecated for web search provider config. ` +
            "Move it under plugins.entries.<plugin>.config.webSearch.*; OpenClaw mapped it automatically for compatibility.",
    }));
    const hasExplicitPluginsConfig = isRecord(raw) && Object.prototype.hasOwnProperty.call(raw, "plugins");
    const resolvePluginConfigIssuePath = (pluginId, errorPath) => {
        const base = `plugins.entries.${pluginId}.config`;
        if (!errorPath || errorPath === "<root>") {
            return base;
        }
        return `${base}.${errorPath}`;
    };
    let registryInfo = null;
    let compatConfig;
    const ensureCompatConfig = () => {
        if (compatConfig !== undefined) {
            return compatConfig ?? config;
        }
        const allow = config.plugins?.allow;
        if (!Array.isArray(allow) || allow.length === 0) {
            compatConfig = config;
            return config;
        }
        const bundledWebSearchPluginIds = new Set(listBundledWebSearchPluginIds());
        const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
        const seenCompatPluginIds = new Set();
        const compatPluginIds = loadPluginManifestRegistry({
            config,
            workspaceDir: workspaceDir ?? undefined,
            env: opts.env,
        })
            .plugins.filter((plugin) => {
            if (seenCompatPluginIds.has(plugin.id)) {
                return false;
            }
            seenCompatPluginIds.add(plugin.id);
            return plugin.origin === "bundled" && bundledWebSearchPluginIds.has(plugin.id);
        })
            .map((plugin) => plugin.id)
            .toSorted((left, right) => left.localeCompare(right));
        compatConfig = withBundledPluginAllowlistCompat({
            config,
            pluginIds: compatPluginIds,
        });
        return compatConfig ?? config;
    };
    const ensureRegistry = () => {
        if (registryInfo) {
            return registryInfo;
        }
        const effectiveConfig = ensureCompatConfig();
        const workspaceDir = resolveAgentWorkspaceDir(effectiveConfig, resolveDefaultAgentId(effectiveConfig));
        const registry = loadPluginManifestRegistry({
            config: effectiveConfig,
            workspaceDir: workspaceDir ?? undefined,
            env: opts.env,
        });
        for (const diag of registry.diagnostics) {
            let path = diag.pluginId ? `plugins.entries.${diag.pluginId}` : "plugins";
            if (!diag.pluginId && diag.message.includes("plugin path not found")) {
                path = "plugins.load.paths";
            }
            const pluginLabel = diag.pluginId ? `plugin ${diag.pluginId}` : "plugin";
            const message = `${pluginLabel}: ${diag.message}`;
            if (diag.level === "error") {
                issues.push({ path, message });
            }
            else {
                warnings.push({ path, message });
            }
        }
        registryInfo = { registry };
        return registryInfo;
    };
    const ensureKnownIds = () => {
        const info = ensureRegistry();
        if (!info.knownIds) {
            info.knownIds = new Set(info.registry.plugins.map((record) => record.id));
        }
        return info.knownIds;
    };
    const ensureNormalizedPlugins = () => {
        const info = ensureRegistry();
        if (!info.normalizedPlugins) {
            info.normalizedPlugins = normalizePluginsConfig(ensureCompatConfig().plugins);
        }
        return info.normalizedPlugins;
    };
    const ensureChannelSchemas = () => {
        const info = ensureRegistry();
        if (!info.channelSchemas) {
            info.channelSchemas = new Map(collectChannelSchemaMetadata(info.registry).map((entry) => [entry.id, { schema: entry.configSchema }]));
        }
        return info.channelSchemas;
    };
    let mutatedConfig = config;
    let channelsCloned = false;
    let pluginsCloned = false;
    let pluginEntriesCloned = false;
    const replaceChannelConfig = (channelId, nextValue) => {
        if (!channelsCloned) {
            mutatedConfig = {
                ...mutatedConfig,
                channels: {
                    ...mutatedConfig.channels,
                },
            };
            channelsCloned = true;
        }
        mutatedConfig.channels[channelId] = nextValue;
    };
    const replacePluginEntryConfig = (pluginId, nextValue) => {
        if (!pluginsCloned) {
            mutatedConfig = {
                ...mutatedConfig,
                plugins: {
                    ...mutatedConfig.plugins,
                },
            };
            pluginsCloned = true;
        }
        if (!pluginEntriesCloned) {
            mutatedConfig.plugins = {
                ...mutatedConfig.plugins,
                entries: {
                    ...mutatedConfig.plugins?.entries,
                },
            };
            pluginEntriesCloned = true;
        }
        const currentEntry = mutatedConfig.plugins?.entries?.[pluginId];
        mutatedConfig.plugins.entries[pluginId] = {
            ...currentEntry,
            config: nextValue,
        };
    };
    const allowedChannels = new Set(["defaults", "modelByChannel", ...CHANNEL_IDS]);
    if (config.channels && isRecord(config.channels)) {
        for (const key of Object.keys(config.channels)) {
            const trimmed = key.trim();
            if (!trimmed) {
                continue;
            }
            if (!allowedChannels.has(trimmed)) {
                const { registry } = ensureRegistry();
                for (const record of registry.plugins) {
                    for (const channelId of record.channels) {
                        allowedChannels.add(channelId);
                    }
                }
            }
            if (!allowedChannels.has(trimmed)) {
                issues.push({
                    path: `channels.${trimmed}`,
                    message: `unknown channel id: ${trimmed}`,
                });
                continue;
            }
            const channelSchema = ensureChannelSchemas().get(trimmed)?.schema;
            if (!channelSchema) {
                continue;
            }
            const result = validateJsonSchemaValue({
                schema: channelSchema,
                cacheKey: `channel:${trimmed}`,
                value: config.channels[trimmed],
                applyDefaults: true,
            });
            if (!result.ok) {
                for (const error of result.errors) {
                    issues.push({
                        path: error.path === "<root>" ? `channels.${trimmed}` : `channels.${trimmed}.${error.path}`,
                        message: `invalid config: ${error.message}`,
                        allowedValues: error.allowedValues,
                        allowedValuesHiddenCount: error.allowedValuesHiddenCount,
                    });
                }
                continue;
            }
            replaceChannelConfig(trimmed, result.value);
        }
    }
    const heartbeatChannelIds = new Set();
    for (const channelId of CHANNEL_IDS) {
        heartbeatChannelIds.add(channelId.toLowerCase());
    }
    const validateHeartbeatTarget = (target, path) => {
        if (typeof target !== "string") {
            return;
        }
        const trimmed = target.trim();
        if (!trimmed) {
            issues.push({ path, message: "heartbeat target must not be empty" });
            return;
        }
        const normalized = trimmed.toLowerCase();
        if (normalized === "last" || normalized === "none") {
            return;
        }
        if (normalizeChatChannelId(trimmed)) {
            return;
        }
        if (!heartbeatChannelIds.has(normalized)) {
            const { registry } = ensureRegistry();
            for (const record of registry.plugins) {
                for (const channelId of record.channels) {
                    const pluginChannel = channelId.trim();
                    if (pluginChannel) {
                        heartbeatChannelIds.add(pluginChannel.toLowerCase());
                    }
                }
            }
        }
        if (heartbeatChannelIds.has(normalized)) {
            return;
        }
        issues.push({ path, message: `unknown heartbeat target: ${target}` });
    };
    validateHeartbeatTarget(config.agents?.defaults?.heartbeat?.target, "agents.defaults.heartbeat.target");
    if (Array.isArray(config.agents?.list)) {
        for (const [index, entry] of config.agents.list.entries()) {
            validateHeartbeatTarget(entry?.heartbeat?.target, `agents.list.${index}.heartbeat.target`);
        }
    }
    if (!hasExplicitPluginsConfig) {
        if (issues.length > 0) {
            return { ok: false, issues, warnings };
        }
        return { ok: true, config: mutatedConfig, warnings };
    }
    const { registry } = ensureRegistry();
    const knownIds = ensureKnownIds();
    const normalizedPlugins = ensureNormalizedPlugins();
    const pushMissingPluginIssue = (path, pluginId, opts) => {
        if (LEGACY_REMOVED_PLUGIN_IDS.has(pluginId)) {
            warnings.push({
                path,
                message: `plugin removed: ${pluginId} (stale config entry ignored; remove it from plugins config)`,
            });
            return;
        }
        if (opts?.warnOnly) {
            warnings.push({
                path,
                message: `plugin not found: ${pluginId} (stale config entry ignored; remove it from plugins config)`,
            });
            return;
        }
        issues.push({
            path,
            message: `plugin not found: ${pluginId}`,
        });
    };
    const pluginsConfig = config.plugins;
    const entries = pluginsConfig?.entries;
    if (entries && isRecord(entries)) {
        for (const pluginId of Object.keys(entries)) {
            if (!knownIds.has(pluginId)) {
                // Keep gateway startup resilient when plugins are removed/renamed across upgrades.
                pushMissingPluginIssue(`plugins.entries.${pluginId}`, pluginId, { warnOnly: true });
            }
        }
    }
    const allow = pluginsConfig?.allow ?? [];
    for (const pluginId of allow) {
        if (typeof pluginId !== "string" || !pluginId.trim()) {
            continue;
        }
        if (!knownIds.has(pluginId)) {
            pushMissingPluginIssue("plugins.allow", pluginId, { warnOnly: true });
        }
    }
    const deny = pluginsConfig?.deny ?? [];
    for (const pluginId of deny) {
        if (typeof pluginId !== "string" || !pluginId.trim()) {
            continue;
        }
        if (!knownIds.has(pluginId)) {
            pushMissingPluginIssue("plugins.deny", pluginId);
        }
    }
    // The default memory slot is inferred; only a user-configured slot should block startup.
    const pluginSlots = pluginsConfig?.slots;
    const hasExplicitMemorySlot = pluginSlots !== undefined && Object.prototype.hasOwnProperty.call(pluginSlots, "memory");
    const memorySlot = normalizedPlugins.slots.memory;
    if (hasExplicitMemorySlot &&
        typeof memorySlot === "string" &&
        memorySlot.trim() &&
        !knownIds.has(memorySlot)) {
        pushMissingPluginIssue("plugins.slots.memory", memorySlot);
    }
    let selectedMemoryPluginId = null;
    const seenPlugins = new Set();
    for (const record of registry.plugins) {
        const pluginId = record.id;
        if (seenPlugins.has(pluginId)) {
            continue;
        }
        seenPlugins.add(pluginId);
        const entry = normalizedPlugins.entries[pluginId];
        const entryHasConfig = Boolean(entry?.config);
        const enableState = resolveEffectiveEnableState({
            id: pluginId,
            origin: record.origin,
            config: normalizedPlugins,
            rootConfig: config,
        });
        let enabled = enableState.enabled;
        let reason = enableState.reason;
        if (enabled) {
            const memoryDecision = resolveMemorySlotDecision({
                id: pluginId,
                kind: record.kind,
                slot: memorySlot,
                selectedId: selectedMemoryPluginId,
            });
            if (!memoryDecision.enabled) {
                enabled = false;
                reason = memoryDecision.reason;
            }
            if (memoryDecision.selected && record.kind === "memory") {
                selectedMemoryPluginId = pluginId;
            }
        }
        const shouldValidate = enabled || entryHasConfig;
        if (shouldValidate) {
            if (record.configSchema) {
                const res = validateJsonSchemaValue({
                    schema: record.configSchema,
                    cacheKey: record.schemaCacheKey ?? record.manifestPath ?? pluginId,
                    value: entry?.config ?? {},
                    applyDefaults: true,
                });
                if (!res.ok) {
                    for (const error of res.errors) {
                        issues.push({
                            path: resolvePluginConfigIssuePath(pluginId, error.path),
                            message: `invalid config: ${error.message}`,
                            allowedValues: error.allowedValues,
                            allowedValuesHiddenCount: error.allowedValuesHiddenCount,
                        });
                    }
                }
                else if (entry || entryHasConfig) {
                    replacePluginEntryConfig(pluginId, res.value);
                }
            }
            else if (record.format === "bundle") {
                // Compatible bundles currently expose no native OpenClaw config schema.
                // Treat them as schema-less capability packs rather than failing validation.
            }
            else {
                issues.push({
                    path: `plugins.entries.${pluginId}`,
                    message: `plugin schema missing for ${pluginId}`,
                });
            }
        }
        if (!enabled && entryHasConfig) {
            warnings.push({
                path: `plugins.entries.${pluginId}`,
                message: `plugin disabled (${reason ?? "disabled"}) but config is present`,
            });
        }
    }
    if (issues.length > 0) {
        return { ok: false, issues, warnings };
    }
    return { ok: true, config: mutatedConfig, warnings };
}
