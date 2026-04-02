import { normalizeChatChannelId } from "../channels/registry.js";
import { BUNDLED_LEGACY_PLUGIN_ID_ALIASES, BUNDLED_PROVIDER_PLUGIN_ID_ALIASES, } from "./bundled-capability-metadata.js";
import { defaultSlotIdForKey } from "./slots.js";
export function normalizePluginId(id) {
    const trimmed = id.trim();
    return (BUNDLED_LEGACY_PLUGIN_ID_ALIASES[trimmed] ??
        BUNDLED_PROVIDER_PLUGIN_ID_ALIASES[trimmed] ??
        trimmed);
}
const normalizeList = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => (typeof entry === "string" ? normalizePluginId(entry) : ""))
        .filter(Boolean);
};
const normalizeSlotValue = (value) => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    if (trimmed.toLowerCase() === "none") {
        return null;
    }
    return trimmed;
};
const normalizePluginEntries = (entries) => {
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
        return {};
    }
    const normalized = {};
    for (const [key, value] of Object.entries(entries)) {
        const normalizedKey = normalizePluginId(key);
        if (!normalizedKey) {
            continue;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            normalized[normalizedKey] = {};
            continue;
        }
        const entry = value;
        const hooksRaw = entry.hooks;
        const hooks = hooksRaw && typeof hooksRaw === "object" && !Array.isArray(hooksRaw)
            ? {
                allowPromptInjection: hooksRaw
                    .allowPromptInjection,
            }
            : undefined;
        const normalizedHooks = hooks && typeof hooks.allowPromptInjection === "boolean"
            ? {
                allowPromptInjection: hooks.allowPromptInjection,
            }
            : undefined;
        const subagentRaw = entry.subagent;
        const subagent = subagentRaw && typeof subagentRaw === "object" && !Array.isArray(subagentRaw)
            ? {
                allowModelOverride: subagentRaw
                    .allowModelOverride,
                hasAllowedModelsConfig: Array.isArray(subagentRaw.allowedModels),
                allowedModels: Array.isArray(subagentRaw.allowedModels)
                    ? subagentRaw.allowedModels
                        .map((model) => (typeof model === "string" ? model.trim() : ""))
                        .filter(Boolean)
                    : undefined,
            }
            : undefined;
        const normalizedSubagent = subagent &&
            (typeof subagent.allowModelOverride === "boolean" ||
                subagent.hasAllowedModelsConfig ||
                (Array.isArray(subagent.allowedModels) && subagent.allowedModels.length > 0))
            ? {
                ...(typeof subagent.allowModelOverride === "boolean"
                    ? { allowModelOverride: subagent.allowModelOverride }
                    : {}),
                ...(subagent.hasAllowedModelsConfig ? { hasAllowedModelsConfig: true } : {}),
                ...(Array.isArray(subagent.allowedModels) && subagent.allowedModels.length > 0
                    ? { allowedModels: subagent.allowedModels }
                    : {}),
            }
            : undefined;
        normalized[normalizedKey] = {
            ...normalized[normalizedKey],
            enabled: typeof entry.enabled === "boolean" ? entry.enabled : normalized[normalizedKey]?.enabled,
            hooks: normalizedHooks ?? normalized[normalizedKey]?.hooks,
            subagent: normalizedSubagent ?? normalized[normalizedKey]?.subagent,
            config: "config" in entry ? entry.config : normalized[normalizedKey]?.config,
        };
    }
    return normalized;
};
export const normalizePluginsConfig = (config) => {
    const memorySlot = normalizeSlotValue(config?.slots?.memory);
    return {
        enabled: config?.enabled !== false,
        allow: normalizeList(config?.allow),
        deny: normalizeList(config?.deny),
        loadPaths: normalizeList(config?.load?.paths),
        slots: {
            memory: memorySlot === undefined ? defaultSlotIdForKey("memory") : memorySlot,
        },
        entries: normalizePluginEntries(config?.entries),
    };
};
const hasExplicitMemorySlot = (plugins) => Boolean(plugins?.slots && Object.prototype.hasOwnProperty.call(plugins.slots, "memory"));
const hasExplicitMemoryEntry = (plugins) => Boolean(plugins?.entries && Object.prototype.hasOwnProperty.call(plugins.entries, "memory-core"));
export const hasExplicitPluginConfig = (plugins) => {
    if (!plugins) {
        return false;
    }
    if (typeof plugins.enabled === "boolean") {
        return true;
    }
    if (Array.isArray(plugins.allow) && plugins.allow.length > 0) {
        return true;
    }
    if (Array.isArray(plugins.deny) && plugins.deny.length > 0) {
        return true;
    }
    if (plugins.load?.paths && Array.isArray(plugins.load.paths) && plugins.load.paths.length > 0) {
        return true;
    }
    if (plugins.slots && Object.keys(plugins.slots).length > 0) {
        return true;
    }
    if (plugins.entries && Object.keys(plugins.entries).length > 0) {
        return true;
    }
    return false;
};
export function applyTestPluginDefaults(cfg, env = process.env) {
    if (!env.VITEST) {
        return cfg;
    }
    const plugins = cfg.plugins;
    const explicitConfig = hasExplicitPluginConfig(plugins);
    if (explicitConfig) {
        if (hasExplicitMemorySlot(plugins) || hasExplicitMemoryEntry(plugins)) {
            return cfg;
        }
        return {
            ...cfg,
            plugins: {
                ...plugins,
                slots: {
                    ...plugins?.slots,
                    memory: "none",
                },
            },
        };
    }
    return {
        ...cfg,
        plugins: {
            ...plugins,
            enabled: false,
            slots: {
                ...plugins?.slots,
                memory: "none",
            },
        },
    };
}
export function isTestDefaultMemorySlotDisabled(cfg, env = process.env) {
    if (!env.VITEST) {
        return false;
    }
    const plugins = cfg.plugins;
    if (hasExplicitMemorySlot(plugins) || hasExplicitMemoryEntry(plugins)) {
        return false;
    }
    return true;
}
export function resolveEnableState(id, origin, config, enabledByDefault) {
    if (!config.enabled) {
        return { enabled: false, reason: "plugins disabled" };
    }
    if (config.deny.includes(id)) {
        return { enabled: false, reason: "blocked by denylist" };
    }
    const entry = config.entries[id];
    if (entry?.enabled === false) {
        return { enabled: false, reason: "disabled in config" };
    }
    const explicitlyAllowed = config.allow.includes(id);
    if (origin === "workspace" && !explicitlyAllowed && entry?.enabled !== true) {
        return { enabled: false, reason: "workspace plugin (disabled by default)" };
    }
    if (config.slots.memory === id) {
        return { enabled: true };
    }
    if (config.allow.length > 0 && !explicitlyAllowed) {
        return { enabled: false, reason: "not in allowlist" };
    }
    if (entry?.enabled === true) {
        return { enabled: true };
    }
    if (origin === "bundled" && enabledByDefault === true) {
        return { enabled: true };
    }
    if (origin === "bundled") {
        return { enabled: false, reason: "bundled (disabled by default)" };
    }
    return { enabled: true };
}
export function isBundledChannelEnabledByChannelConfig(cfg, pluginId) {
    if (!cfg) {
        return false;
    }
    const channelId = normalizeChatChannelId(pluginId);
    if (!channelId) {
        return false;
    }
    const channels = cfg.channels;
    const entry = channels?.[channelId];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
    }
    return entry.enabled === true;
}
export function resolveEffectiveEnableState(params) {
    const base = resolveEnableState(params.id, params.origin, params.config, params.enabledByDefault);
    if (!base.enabled &&
        base.reason === "bundled (disabled by default)" &&
        isBundledChannelEnabledByChannelConfig(params.rootConfig, params.id)) {
        return { enabled: true };
    }
    return base;
}
export function resolveMemorySlotDecision(params) {
    if (params.kind !== "memory") {
        return { enabled: true };
    }
    if (params.slot === null) {
        return { enabled: false, reason: "memory slot disabled" };
    }
    if (typeof params.slot === "string") {
        if (params.slot === params.id) {
            return { enabled: true, selected: true };
        }
        return {
            enabled: false,
            reason: `memory slot set to "${params.slot}"`,
        };
    }
    if (params.selectedId && params.selectedId !== params.id) {
        return {
            enabled: false,
            reason: `memory slot already filled by "${params.selectedId}"`,
        };
    }
    return { enabled: true, selected: true };
}
