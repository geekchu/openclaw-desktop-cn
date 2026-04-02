import { resolvePluginWebSearchConfig } from "../../config/legacy-web-search.js";
function cloneWithDescriptors(value) {
    const next = Object.create(Object.getPrototypeOf(value ?? {}));
    if (value) {
        Object.defineProperties(next, Object.getOwnPropertyDescriptors(value));
    }
    return next;
}
export function withForcedProvider(config, provider) {
    const next = cloneWithDescriptors(config ?? {});
    const tools = cloneWithDescriptors(next.tools ?? {});
    const web = cloneWithDescriptors(tools.web ?? {});
    const search = cloneWithDescriptors(web.search ?? {});
    search.provider = provider;
    web.search = search;
    tools.web = web;
    next.tools = tools;
    return next;
}
export function getTopLevelCredentialValue(searchConfig) {
    return searchConfig?.apiKey;
}
export function setTopLevelCredentialValue(searchConfigTarget, value) {
    searchConfigTarget.apiKey = value;
}
export function getScopedCredentialValue(searchConfig, key) {
    const scoped = searchConfig?.[key];
    if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
        return undefined;
    }
    return scoped.apiKey;
}
export function setScopedCredentialValue(searchConfigTarget, key, value) {
    const scoped = searchConfigTarget[key];
    if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
        searchConfigTarget[key] = { apiKey: value };
        return;
    }
    scoped.apiKey = value;
}
export function mergeScopedSearchConfig(searchConfig, key, pluginConfig, options) {
    if (!pluginConfig) {
        return searchConfig;
    }
    const currentScoped = searchConfig?.[key] &&
        typeof searchConfig[key] === "object" &&
        !Array.isArray(searchConfig[key])
        ? searchConfig[key]
        : {};
    const next = {
        ...searchConfig,
        [key]: {
            ...currentScoped,
            ...pluginConfig,
        },
    };
    if (options?.mirrorApiKeyToTopLevel && pluginConfig.apiKey !== undefined) {
        next.apiKey = pluginConfig.apiKey;
    }
    return next;
}
export function resolveSearchConfig(cfg) {
    const search = cfg?.tools?.web?.search;
    if (!search || typeof search !== "object") {
        return undefined;
    }
    return search;
}
export function resolveProviderWebSearchPluginConfig(config, pluginId) {
    return resolvePluginWebSearchConfig(config, pluginId);
}
function ensureObject(target, key) {
    const current = target[key];
    if (current && typeof current === "object" && !Array.isArray(current)) {
        return current;
    }
    const next = {};
    target[key] = next;
    return next;
}
export function setProviderWebSearchPluginConfigValue(configTarget, pluginId, key, value) {
    const plugins = ensureObject(configTarget, "plugins");
    const entries = ensureObject(plugins, "entries");
    const entry = ensureObject(entries, pluginId);
    if (entry.enabled === undefined) {
        entry.enabled = true;
    }
    const config = ensureObject(entry, "config");
    const webSearch = ensureObject(config, "webSearch");
    webSearch[key] = value;
}
export function resolveSearchEnabled(params) {
    if (typeof params.search?.enabled === "boolean") {
        return params.search.enabled;
    }
    if (params.sandboxed) {
        return true;
    }
    return true;
}
