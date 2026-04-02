import { normalizeProviderId } from "../agents/provider-id.js";
import { resolveCatalogHookProviderPluginIds, resolveOwningPluginIdsForProvider, } from "./providers.js";
import { resolvePluginProviders } from "./providers.runtime.js";
import { resolvePluginCacheInputs } from "./roots.js";
function matchesProviderId(provider, providerId) {
    const normalized = normalizeProviderId(providerId);
    if (!normalized) {
        return false;
    }
    if (normalizeProviderId(provider.id) === normalized) {
        return true;
    }
    return [...(provider.aliases ?? []), ...(provider.hookAliases ?? [])].some((alias) => normalizeProviderId(alias) === normalized);
}
let cachedHookProvidersWithoutConfig = new WeakMap();
let cachedHookProvidersByConfig = new WeakMap();
function resolveHookProviderCacheBucket(params) {
    if (!params.config) {
        let bucket = cachedHookProvidersWithoutConfig.get(params.env);
        if (!bucket) {
            bucket = new Map();
            cachedHookProvidersWithoutConfig.set(params.env, bucket);
        }
        return bucket;
    }
    let envBuckets = cachedHookProvidersByConfig.get(params.config);
    if (!envBuckets) {
        envBuckets = new WeakMap();
        cachedHookProvidersByConfig.set(params.config, envBuckets);
    }
    let bucket = envBuckets.get(params.env);
    if (!bucket) {
        bucket = new Map();
        envBuckets.set(params.env, bucket);
    }
    return bucket;
}
function buildHookProviderCacheKey(params) {
    const { roots } = resolvePluginCacheInputs({
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    return `${roots.workspace ?? ""}::${roots.global}::${roots.stock ?? ""}::${JSON.stringify(params.config ?? null)}::${JSON.stringify(params.onlyPluginIds ?? [])}`;
}
export function clearProviderRuntimeHookCache() {
    cachedHookProvidersWithoutConfig = new WeakMap();
    cachedHookProvidersByConfig = new WeakMap();
}
export function resetProviderRuntimeHookCacheForTest() {
    clearProviderRuntimeHookCache();
}
function resolveProviderPluginsForHooks(params) {
    const env = params.env ?? process.env;
    const cacheBucket = resolveHookProviderCacheBucket({
        config: params.config,
        env,
    });
    const cacheKey = buildHookProviderCacheKey({
        config: params.config,
        workspaceDir: params.workspaceDir,
        onlyPluginIds: params.onlyPluginIds,
        env,
    });
    const cached = cacheBucket.get(cacheKey);
    if (cached) {
        return cached;
    }
    const resolved = resolvePluginProviders({
        ...params,
        env,
        activate: false,
        cache: false,
        bundledProviderAllowlistCompat: true,
        bundledProviderVitestCompat: true,
    });
    cacheBucket.set(cacheKey, resolved);
    return resolved;
}
function resolveProviderPluginsForCatalogHooks(params) {
    const onlyPluginIds = resolveCatalogHookProviderPluginIds({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    if (onlyPluginIds.length === 0) {
        return [];
    }
    return resolveProviderPluginsForHooks({
        ...params,
        onlyPluginIds,
    });
}
export function resolveProviderRuntimePlugin(params) {
    const owningPluginIds = resolveOwningPluginIdsForProvider({
        provider: params.provider,
        config: params.config,
        workspaceDir: params.workspaceDir,
        env: params.env,
    });
    if (!owningPluginIds || owningPluginIds.length === 0) {
        return undefined;
    }
    return resolveProviderPluginsForHooks({
        ...params,
        onlyPluginIds: owningPluginIds,
    }).find((plugin) => matchesProviderId(plugin, params.provider));
}
export function runProviderDynamicModel(params) {
    return resolveProviderRuntimePlugin(params)?.resolveDynamicModel?.(params.context) ?? undefined;
}
export async function prepareProviderDynamicModel(params) {
    await resolveProviderRuntimePlugin(params)?.prepareDynamicModel?.(params.context);
}
export function normalizeProviderResolvedModelWithPlugin(params) {
    return (resolveProviderRuntimePlugin(params)?.normalizeResolvedModel?.(params.context) ?? undefined);
}
function resolveProviderHookPlugin(params) {
    return (resolveProviderRuntimePlugin(params) ??
        resolveProviderPluginsForHooks({
            config: params.config,
            workspaceDir: params.workspaceDir,
            env: params.env,
        }).find((candidate) => matchesProviderId(candidate, params.provider)));
}
export function normalizeProviderModelIdWithPlugin(params) {
    const plugin = resolveProviderHookPlugin(params);
    const normalized = plugin?.normalizeModelId?.(params.context);
    const trimmed = normalized?.trim();
    return trimmed ? trimmed : undefined;
}
export function normalizeProviderTransportWithPlugin(params) {
    const matchedPlugin = resolveProviderHookPlugin(params);
    const normalizedMatched = matchedPlugin?.normalizeTransport?.(params.context);
    if (normalizedMatched) {
        return normalizedMatched;
    }
    for (const candidate of resolveProviderPluginsForHooks(params)) {
        if (!candidate.normalizeTransport || candidate === matchedPlugin) {
            continue;
        }
        const normalized = candidate.normalizeTransport(params.context);
        if (normalized) {
            return normalized;
        }
    }
    return undefined;
}
export function normalizeProviderConfigWithPlugin(params) {
    return resolveProviderHookPlugin(params)?.normalizeConfig?.(params.context) ?? undefined;
}
export function applyProviderNativeStreamingUsageCompatWithPlugin(params) {
    return (resolveProviderHookPlugin(params)?.applyNativeStreamingUsageCompat?.(params.context) ??
        undefined);
}
export function resolveProviderConfigApiKeyWithPlugin(params) {
    const resolved = resolveProviderHookPlugin(params)?.resolveConfigApiKey?.(params.context);
    const trimmed = resolved?.trim();
    return trimmed ? trimmed : undefined;
}
export function resolveProviderCapabilitiesWithPlugin(params) {
    return resolveProviderRuntimePlugin(params)?.capabilities;
}
export function prepareProviderExtraParams(params) {
    return resolveProviderRuntimePlugin(params)?.prepareExtraParams?.(params.context) ?? undefined;
}
export function resolveProviderStreamFn(params) {
    return resolveProviderRuntimePlugin(params)?.createStreamFn?.(params.context) ?? undefined;
}
export function wrapProviderStreamFn(params) {
    return resolveProviderRuntimePlugin(params)?.wrapStreamFn?.(params.context) ?? undefined;
}
export async function createProviderEmbeddingProvider(params) {
    return await resolveProviderRuntimePlugin(params)?.createEmbeddingProvider?.(params.context);
}
export async function prepareProviderRuntimeAuth(params) {
    return await resolveProviderRuntimePlugin(params)?.prepareRuntimeAuth?.(params.context);
}
export async function resolveProviderUsageAuthWithPlugin(params) {
    return await resolveProviderRuntimePlugin(params)?.resolveUsageAuth?.(params.context);
}
export async function resolveProviderUsageSnapshotWithPlugin(params) {
    return await resolveProviderRuntimePlugin(params)?.fetchUsageSnapshot?.(params.context);
}
export function formatProviderAuthProfileApiKeyWithPlugin(params) {
    return resolveProviderRuntimePlugin(params)?.formatApiKey?.(params.context);
}
export async function refreshProviderOAuthCredentialWithPlugin(params) {
    return await resolveProviderRuntimePlugin(params)?.refreshOAuth?.(params.context);
}
export async function buildProviderAuthDoctorHintWithPlugin(params) {
    return await resolveProviderRuntimePlugin(params)?.buildAuthDoctorHint?.(params.context);
}
export function resolveProviderCacheTtlEligibility(params) {
    return resolveProviderRuntimePlugin(params)?.isCacheTtlEligible?.(params.context);
}
export function resolveProviderBinaryThinking(params) {
    return resolveProviderRuntimePlugin(params)?.isBinaryThinking?.(params.context);
}
export function resolveProviderXHighThinking(params) {
    return resolveProviderRuntimePlugin(params)?.supportsXHighThinking?.(params.context);
}
export function resolveProviderDefaultThinkingLevel(params) {
    return resolveProviderRuntimePlugin(params)?.resolveDefaultThinkingLevel?.(params.context);
}
export function resolveProviderModernModelRef(params) {
    return resolveProviderRuntimePlugin(params)?.isModernModelRef?.(params.context);
}
export function buildProviderMissingAuthMessageWithPlugin(params) {
    return (resolveProviderRuntimePlugin(params)?.buildMissingAuthMessage?.(params.context) ?? undefined);
}
export function buildProviderUnknownModelHintWithPlugin(params) {
    return resolveProviderRuntimePlugin(params)?.buildUnknownModelHint?.(params.context) ?? undefined;
}
export function resolveProviderSyntheticAuthWithPlugin(params) {
    return resolveProviderRuntimePlugin(params)?.resolveSyntheticAuth?.(params.context) ?? undefined;
}
export function resolveProviderBuiltInModelSuppression(params) {
    for (const plugin of resolveProviderPluginsForCatalogHooks(params)) {
        const result = plugin.suppressBuiltInModel?.(params.context);
        if (result?.suppress) {
            return result;
        }
    }
    return undefined;
}
export async function augmentModelCatalogWithProviderPlugins(params) {
    const supplemental = [];
    for (const plugin of resolveProviderPluginsForCatalogHooks(params)) {
        const next = await plugin.augmentModelCatalog?.(params.context);
        if (!next || next.length === 0) {
            continue;
        }
        supplemental.push(...next);
    }
    return supplemental;
}
