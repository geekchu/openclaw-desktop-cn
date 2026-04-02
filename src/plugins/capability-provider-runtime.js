import { withBundledPluginAllowlistCompat, withBundledPluginEnablementCompat, withBundledPluginVitestCompat, } from "./bundled-compat.js";
import { resolveRuntimePluginRegistry } from "./loader.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
const CAPABILITY_CONTRACT_KEY = {
    speechProviders: "speechProviders",
    mediaUnderstandingProviders: "mediaUnderstandingProviders",
    imageGenerationProviders: "imageGenerationProviders",
};
function resolveBundledCapabilityCompatPluginIds(params) {
    const contractKey = CAPABILITY_CONTRACT_KEY[params.key];
    return loadPluginManifestRegistry({
        config: params.cfg,
        env: process.env,
    })
        .plugins.filter((plugin) => plugin.origin === "bundled" && (plugin.contracts?.[contractKey]?.length ?? 0) > 0)
        .map((plugin) => plugin.id)
        .toSorted((left, right) => left.localeCompare(right));
}
function resolveCapabilityProviderConfig(params) {
    const pluginIds = resolveBundledCapabilityCompatPluginIds(params);
    const allowlistCompat = withBundledPluginAllowlistCompat({
        config: params.cfg,
        pluginIds,
    });
    const enablementCompat = withBundledPluginEnablementCompat({
        config: allowlistCompat,
        pluginIds,
    });
    return withBundledPluginVitestCompat({
        config: enablementCompat,
        pluginIds,
        env: process.env,
    });
}
export function resolvePluginCapabilityProviders(params) {
    const activeRegistry = resolveRuntimePluginRegistry();
    const activeProviders = activeRegistry?.[params.key] ?? [];
    if (activeProviders.length > 0) {
        return activeProviders.map((entry) => entry.provider);
    }
    const loadOptions = params.cfg === undefined
        ? undefined
        : {
            config: resolveCapabilityProviderConfig({ key: params.key, cfg: params.cfg }),
        };
    const registry = resolveRuntimePluginRegistry(loadOptions);
    return (registry?.[params.key] ?? []).map((entry) => entry.provider);
}
