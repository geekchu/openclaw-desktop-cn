import { normalizeProviderId } from "../agents/provider-id.js";
import { withBundledPluginVitestCompat } from "./bundled-compat.js";
import { normalizePluginsConfig, resolveEffectivePluginActivationState } from "./config-state.js";
import { loadPluginManifestRegistry, } from "./manifest-registry.js";
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
        resolveEffectivePluginActivationState({
            id: plugin.id,
            origin: plugin.origin,
            config: normalizedConfig,
            rootConfig: params.config,
            enabledByDefault: plugin.enabledByDefault,
        }).activated)
        .map((plugin) => plugin.id)
        .toSorted((left, right) => left.localeCompare(right));
}
export function resolveDiscoveredProviderPluginIds(params) {
    const onlyPluginIdSet = params.onlyPluginIds ? new Set(params.onlyPluginIds) : null;
    const registry = loadPluginManifestRegistry({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    const shouldFilterUntrustedWorkspacePlugins = params.includeUntrustedWorkspacePlugins === false;
    const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
    return registry.plugins
        .filter((plugin) => {
        if (!(plugin.providers.length > 0 && (!onlyPluginIdSet || onlyPluginIdSet.has(plugin.id)))) {
            return false;
        }
        if (!shouldFilterUntrustedWorkspacePlugins || plugin.origin !== "workspace") {
            return true;
        }
        const activation = resolveEffectivePluginActivationState({
            id: plugin.id,
            origin: plugin.origin,
            config: normalizedConfig,
            rootConfig: params.config,
            enabledByDefault: plugin.enabledByDefault,
        });
        if (activation.activated) {
            return true;
        }
        const explicitlyTrustedButDisabled = normalizedConfig.enabled &&
            !normalizedConfig.deny.includes(plugin.id) &&
            normalizedConfig.allow.includes(plugin.id) &&
            normalizedConfig.entries[plugin.id]?.enabled === false;
        return explicitlyTrustedButDisabled;
    })
        .map((plugin) => plugin.id)
        .toSorted((left, right) => left.localeCompare(right));
}
export const __testing = {
    resolveEnabledProviderPluginIds,
    resolveDiscoveredProviderPluginIds,
    resolveBundledProviderCompatPluginIds,
    withBundledProviderVitestCompat,
};
function resolveManifestRegistry(params) {
    return (params.manifestRegistry ??
        loadPluginManifestRegistry({
            config: params.config,
            workspaceDir: params.workspaceDir,
            env: params.env,
        }));
}
function stripModelProfileSuffix(value) {
    const trimmed = value.trim();
    const at = trimmed.indexOf("@");
    return at <= 0 ? trimmed : trimmed.slice(0, at).trim();
}
function splitExplicitModelRef(rawModel) {
    const trimmed = rawModel.trim();
    if (!trimmed) {
        return null;
    }
    const slash = trimmed.indexOf("/");
    if (slash === -1) {
        const modelId = stripModelProfileSuffix(trimmed);
        return modelId ? { modelId } : null;
    }
    const provider = normalizeProviderId(trimmed.slice(0, slash));
    const modelId = stripModelProfileSuffix(trimmed.slice(slash + 1));
    if (!provider || !modelId) {
        return null;
    }
    return { provider, modelId };
}
function resolveModelSupportMatchKind(plugin, modelId) {
    const patterns = plugin.modelSupport?.modelPatterns ?? [];
    for (const patternSource of patterns) {
        try {
            if (new RegExp(patternSource, "u").test(modelId)) {
                return "pattern";
            }
        }
        catch {
            continue;
        }
    }
    const prefixes = plugin.modelSupport?.modelPrefixes ?? [];
    for (const prefix of prefixes) {
        if (modelId.startsWith(prefix)) {
            return "prefix";
        }
    }
    return undefined;
}
function dedupeSortedPluginIds(values) {
    return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}
function resolvePreferredManifestPluginIds(registry, matchedPluginIds) {
    if (matchedPluginIds.length === 0) {
        return undefined;
    }
    const uniquePluginIds = dedupeSortedPluginIds(matchedPluginIds);
    if (uniquePluginIds.length <= 1) {
        return uniquePluginIds;
    }
    const nonBundledPluginIds = uniquePluginIds.filter((pluginId) => {
        const plugin = registry.plugins.find((entry) => entry.id === pluginId);
        return plugin?.origin !== "bundled";
    });
    if (nonBundledPluginIds.length === 1) {
        return nonBundledPluginIds;
    }
    if (nonBundledPluginIds.length > 1) {
        return undefined;
    }
    return undefined;
}
export function resolveOwningPluginIdsForProvider(params) {
    const normalizedProvider = normalizeProviderId(params.provider);
    if (!normalizedProvider) {
        return undefined;
    }
    const registry = resolveManifestRegistry(params);
    const pluginIds = registry.plugins
        .filter((plugin) => plugin.providers.some((providerId) => normalizeProviderId(providerId) === normalizedProvider) ||
        plugin.cliBackends.some((backendId) => normalizeProviderId(backendId) === normalizedProvider))
        .map((plugin) => plugin.id);
    return pluginIds.length > 0 ? pluginIds : undefined;
}
export function resolveOwningPluginIdsForModelRef(params) {
    const parsed = splitExplicitModelRef(params.model);
    if (!parsed) {
        return undefined;
    }
    if (parsed.provider) {
        return resolveOwningPluginIdsForProvider({
            provider: parsed.provider,
            config: params.config,
            workspaceDir: params.workspaceDir,
            env: params.env,
            manifestRegistry: params.manifestRegistry,
        });
    }
    const registry = resolveManifestRegistry(params);
    const matchedByPattern = registry.plugins
        .filter((plugin) => resolveModelSupportMatchKind(plugin, parsed.modelId) === "pattern")
        .map((plugin) => plugin.id);
    const preferredPatternPluginIds = resolvePreferredManifestPluginIds(registry, matchedByPattern);
    if (preferredPatternPluginIds) {
        return preferredPatternPluginIds;
    }
    const matchedByPrefix = registry.plugins
        .filter((plugin) => resolveModelSupportMatchKind(plugin, parsed.modelId) === "prefix")
        .map((plugin) => plugin.id);
    return resolvePreferredManifestPluginIds(registry, matchedByPrefix);
}
export function resolveOwningPluginIdsForModelRefs(params) {
    const registry = resolveManifestRegistry(params);
    return dedupeSortedPluginIds(params.models.flatMap((model) => resolveOwningPluginIdsForModelRef({
        model,
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
        manifestRegistry: registry,
    }) ?? []));
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
        resolveEffectivePluginActivationState({
            id: plugin.id,
            origin: plugin.origin,
            config: normalizedConfig,
            rootConfig: params.config,
        }).activated)
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
        resolveEffectivePluginActivationState({
            id: plugin.id,
            origin: plugin.origin,
            config: normalizedConfig,
            rootConfig: params.config,
            enabledByDefault: plugin.enabledByDefault,
        }).activated)
        .map((plugin) => plugin.id);
    const bundledCompatPluginIds = resolveBundledProviderCompatPluginIds(params);
    return [...new Set([...enabledProviderPluginIds, ...bundledCompatPluginIds])].toSorted((left, right) => left.localeCompare(right));
}
