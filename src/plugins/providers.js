import { normalizeProviderId } from "../agents/provider-id.js";
import { withBundledPluginVitestCompat } from "./bundled-compat.js";
import { normalizePluginsConfig, resolveEffectiveEnableState } from "./config-state.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
export function withBundledProviderVitestCompat(params) {
    return withBundledPluginVitestCompat(params);
}
export function resolveBundledProviderCompatPluginIds(params) {
    const onlyPluginIdSet = params.onlyPluginIds ? new Set(params.onlyPluginIds) : null;
    const registry = loadPluginManifestRegistry({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    return registry.plugins
        .filter((plugin) => plugin.origin === "bundled" &&
        plugin.providers.length > 0 &&
        (!onlyPluginIdSet || onlyPluginIdSet.has(plugin.id)))
        .map((plugin) => plugin.id)
        .toSorted((left, right) => left.localeCompare(right));
}
export function resolveEnabledProviderPluginIds(params) {
    const onlyPluginIdSet = params.onlyPluginIds ? new Set(params.onlyPluginIds) : null;
    const registry = loadPluginManifestRegistry({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
    return registry.plugins
        .filter((plugin) => plugin.providers.length > 0 &&
        (!onlyPluginIdSet || onlyPluginIdSet.has(plugin.id)) &&
        resolveEffectiveEnableState({
            id: plugin.id,
            origin: plugin.origin,
            config: normalizedConfig,
            rootConfig: params.config,
        }).enabled)
        .map((plugin) => plugin.id)
        .toSorted((left, right) => left.localeCompare(right));
}
export const __testing = {
    resolveEnabledProviderPluginIds,
    resolveBundledProviderCompatPluginIds,
    withBundledProviderVitestCompat,
};
export function resolveOwningPluginIdsForProvider(params) {
    const normalizedProvider = normalizeProviderId(params.provider);
    if (!normalizedProvider) {
        return undefined;
    }
    const registry = loadPluginManifestRegistry({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    const pluginIds = registry.plugins
        .filter((plugin) => plugin.providers.some((providerId) => normalizeProviderId(providerId) === normalizedProvider))
        .map((plugin) => plugin.id);
    return pluginIds.length > 0 ? pluginIds : undefined;
}
export function resolveNonBundledProviderPluginIds(params) {
    const registry = loadPluginManifestRegistry({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
    return registry.plugins
        .filter((plugin) => plugin.origin !== "bundled" &&
        plugin.providers.length > 0 &&
        resolveEffectiveEnableState({
            id: plugin.id,
            origin: plugin.origin,
            config: normalizedConfig,
            rootConfig: params.config,
        }).enabled)
        .map((plugin) => plugin.id)
        .toSorted((left, right) => left.localeCompare(right));
}
export function resolveCatalogHookProviderPluginIds(params) {
    const registry = loadPluginManifestRegistry({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
    const enabledProviderPluginIds = registry.plugins
        .filter((plugin) => plugin.providers.length > 0 &&
        resolveEffectiveEnableState({
            id: plugin.id,
            origin: plugin.origin,
            config: normalizedConfig,
            rootConfig: params.config,
        }).enabled)
        .map((plugin) => plugin.id);
    const bundledCompatPluginIds = resolveBundledProviderCompatPluginIds(params);
    return [...new Set([...enabledProviderPluginIds, ...bundledCompatPluginIds])].toSorted((left, right) => left.localeCompare(right));
}
