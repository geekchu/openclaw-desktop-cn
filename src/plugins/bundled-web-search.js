import { BUNDLED_WEB_SEARCH_PLUGIN_IDS } from "./bundled-capability-metadata.js";
import { loadBundledCapabilityRuntimeRegistry } from "./bundled-capability-runtime.js";
import { resolveBundledWebSearchPluginId as resolveBundledWebSearchPluginIdFromMap } from "./bundled-web-search-provider-ids.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
let bundledWebSearchProvidersCache = null;
function loadBundledWebSearchProviders() {
    if (!bundledWebSearchProvidersCache) {
        bundledWebSearchProvidersCache = loadBundledCapabilityRuntimeRegistry({
            pluginIds: BUNDLED_WEB_SEARCH_PLUGIN_IDS,
            pluginSdkResolution: "dist",
        }).webSearchProviders.map((entry) => ({
            pluginId: entry.pluginId,
            ...entry.provider,
        }));
    }
    return bundledWebSearchProvidersCache;
}
export function resolveBundledWebSearchPluginIds(params) {
    const bundledWebSearchPluginIdSet = new Set(BUNDLED_WEB_SEARCH_PLUGIN_IDS);
    return loadPluginManifestRegistry({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    })
        .plugins.filter((plugin) => plugin.origin === "bundled" && bundledWebSearchPluginIdSet.has(plugin.id))
        .map((plugin) => plugin.id)
        .toSorted((left, right) => left.localeCompare(right));
}
export function listBundledWebSearchPluginIds() {
    return [...BUNDLED_WEB_SEARCH_PLUGIN_IDS];
}
export function listBundledWebSearchProviders() {
    return loadBundledWebSearchProviders();
}
export function resolveBundledWebSearchPluginId(providerId) {
    return resolveBundledWebSearchPluginIdFromMap(providerId);
}
