import { listBundledWebSearchProviders as listBundledWebSearchProviderEntries } from "./bundled-web-search.js";
import { resolveEffectiveEnableState } from "./config-state.js";
import { resolveBundledWebSearchResolutionConfig, sortWebSearchProviders, } from "./web-search-providers.shared.js";
function listBundledWebSearchProviders() {
    return sortWebSearchProviders(listBundledWebSearchProviderEntries());
}
export function resolveBundledPluginWebSearchProviders(params) {
    const { config, normalized } = resolveBundledWebSearchResolutionConfig(params);
    const onlyPluginIdSet = params.onlyPluginIds && params.onlyPluginIds.length > 0 ? new Set(params.onlyPluginIds) : null;
    return listBundledWebSearchProviders().filter((provider) => {
        if (onlyPluginIdSet && !onlyPluginIdSet.has(provider.pluginId)) {
            return false;
        }
        return resolveEffectiveEnableState({
            id: provider.pluginId,
            origin: "bundled",
            config: normalized,
            rootConfig: config,
        }).enabled;
    });
}
