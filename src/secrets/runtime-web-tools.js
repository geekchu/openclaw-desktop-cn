import { resolveSecretInputRef } from "../config/types.secrets.js";
import { listBundledWebSearchPluginIds } from "../plugins/bundled-web-search-ids.js";
import { resolveBundledWebSearchPluginId } from "../plugins/bundled-web-search-provider-ids.js";
import { resolveBundledPluginWebSearchProviders } from "../plugins/web-search-providers.js";
import { resolvePluginWebSearchProviders } from "../plugins/web-search-providers.runtime.js";
import { sortWebSearchProvidersForAutoDetect } from "../plugins/web-search-providers.shared.js";
import { normalizeSecretInput } from "../utils/normalize-secret-input.js";
import { secretRefKey } from "./ref-contract.js";
import { resolveSecretRefValues } from "./resolve.js";
import { pushInactiveSurfaceWarning, pushWarning, } from "./runtime-shared.js";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeProvider(value, providers) {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (providers.some((provider) => provider.id === normalized)) {
        return normalized;
    }
    return undefined;
}
function hasCustomWebSearchPluginRisk(config) {
    const plugins = config.plugins;
    if (!plugins) {
        return false;
    }
    if (Array.isArray(plugins.load?.paths) && plugins.load.paths.length > 0) {
        return true;
    }
    if (plugins.installs && Object.keys(plugins.installs).length > 0) {
        return true;
    }
    const bundledPluginIds = new Set(listBundledWebSearchPluginIds());
    const hasNonBundledPluginId = (pluginId) => !bundledPluginIds.has(pluginId.trim());
    if (Array.isArray(plugins.allow) && plugins.allow.some(hasNonBundledPluginId)) {
        return true;
    }
    if (Array.isArray(plugins.deny) && plugins.deny.some(hasNonBundledPluginId)) {
        return true;
    }
    if (plugins.entries && Object.keys(plugins.entries).some(hasNonBundledPluginId)) {
        return true;
    }
    return false;
}
function readNonEmptyEnvValue(env, names) {
    for (const envVar of names) {
        const value = normalizeSecretInput(env[envVar]);
        if (value) {
            return { value, envVar };
        }
    }
    return {};
}
function buildUnresolvedReason(params) {
    if (params.kind === "non-string") {
        return `${params.path} SecretRef resolved to a non-string value.`;
    }
    if (params.kind === "empty") {
        return `${params.path} SecretRef resolved to an empty value.`;
    }
    return `${params.path} SecretRef is unresolved (${params.refLabel}).`;
}
async function resolveSecretInputWithEnvFallback(params) {
    const { ref } = resolveSecretInputRef({
        value: params.value,
        defaults: params.defaults,
    });
    if (!ref) {
        const configValue = normalizeSecretInput(params.value);
        if (configValue) {
            return {
                value: configValue,
                source: "config",
                secretRefConfigured: false,
                fallbackUsedAfterRefFailure: false,
            };
        }
        const fallback = readNonEmptyEnvValue(params.context.env, params.envVars);
        if (fallback.value) {
            return {
                value: fallback.value,
                source: "env",
                fallbackEnvVar: fallback.envVar,
                secretRefConfigured: false,
                fallbackUsedAfterRefFailure: false,
            };
        }
        return {
            source: "missing",
            secretRefConfigured: false,
            fallbackUsedAfterRefFailure: false,
        };
    }
    const refLabel = `${ref.source}:${ref.provider}:${ref.id}`;
    let resolvedFromRef;
    let unresolvedRefReason;
    try {
        const resolved = await resolveSecretRefValues([ref], {
            config: params.sourceConfig,
            env: params.context.env,
            cache: params.context.cache,
        });
        const resolvedValue = resolved.get(secretRefKey(ref));
        if (typeof resolvedValue !== "string") {
            unresolvedRefReason = buildUnresolvedReason({
                path: params.path,
                kind: "non-string",
                refLabel,
            });
        }
        else {
            resolvedFromRef = normalizeSecretInput(resolvedValue);
            if (!resolvedFromRef) {
                unresolvedRefReason = buildUnresolvedReason({
                    path: params.path,
                    kind: "empty",
                    refLabel,
                });
            }
        }
    }
    catch {
        unresolvedRefReason = buildUnresolvedReason({
            path: params.path,
            kind: "unresolved",
            refLabel,
        });
    }
    if (resolvedFromRef) {
        return {
            value: resolvedFromRef,
            source: "secretRef",
            secretRefConfigured: true,
            fallbackUsedAfterRefFailure: false,
        };
    }
    const fallback = readNonEmptyEnvValue(params.context.env, params.envVars);
    if (fallback.value) {
        return {
            value: fallback.value,
            source: "env",
            fallbackEnvVar: fallback.envVar,
            unresolvedRefReason,
            secretRefConfigured: true,
            fallbackUsedAfterRefFailure: true,
        };
    }
    return {
        source: "missing",
        unresolvedRefReason,
        secretRefConfigured: true,
        fallbackUsedAfterRefFailure: false,
    };
}
function ensureObject(target, key) {
    const current = target[key];
    if (isRecord(current)) {
        return current;
    }
    const next = {};
    target[key] = next;
    return next;
}
function setResolvedWebSearchApiKey(params) {
    const tools = ensureObject(params.resolvedConfig, "tools");
    const web = ensureObject(tools, "web");
    const search = ensureObject(web, "search");
    if (params.provider.setConfiguredCredentialValue) {
        params.provider.setConfiguredCredentialValue(params.resolvedConfig, params.value);
    }
    params.provider.setCredentialValue(search, params.value);
}
function setResolvedFirecrawlApiKey(params) {
    const tools = ensureObject(params.resolvedConfig, "tools");
    const web = ensureObject(tools, "web");
    const fetch = ensureObject(web, "fetch");
    const firecrawl = ensureObject(fetch, "firecrawl");
    firecrawl.apiKey = params.value;
}
function setResolvedXSearchApiKey(params) {
    const tools = ensureObject(params.resolvedConfig, "tools");
    const web = ensureObject(tools, "web");
    const xSearch = ensureObject(web, "x_search");
    xSearch.apiKey = params.value;
}
function keyPathForProvider(provider) {
    return provider.credentialPath;
}
function inactivePathsForProvider(provider) {
    if (provider.requiresCredential === false) {
        return [];
    }
    return provider.inactiveSecretPaths?.length
        ? provider.inactiveSecretPaths
        : [provider.credentialPath];
}
function hasConfiguredSecretRef(value, defaults) {
    return Boolean(resolveSecretInputRef({
        value,
        defaults,
    }).ref);
}
export async function resolveRuntimeWebTools(params) {
    const defaults = params.sourceConfig.secrets?.defaults;
    const diagnostics = [];
    const tools = isRecord(params.sourceConfig.tools) ? params.sourceConfig.tools : undefined;
    const web = isRecord(tools?.web) ? tools.web : undefined;
    const search = isRecord(web?.search) ? web.search : undefined;
    const rawProvider = typeof search?.provider === "string" ? search.provider.trim().toLowerCase() : "";
    const configuredBundledPluginId = resolveBundledWebSearchPluginId(rawProvider);
    const searchMetadata = {
        providerSource: "none",
        diagnostics: [],
    };
    const searchConfigured = Boolean(search);
    const searchEnabled = searchConfigured && search?.enabled !== false;
    const providers = sortWebSearchProvidersForAutoDetect(searchConfigured
        ? configuredBundledPluginId
            ? resolveBundledPluginWebSearchProviders({
                config: params.sourceConfig,
                env: { ...process.env, ...params.context.env },
                bundledAllowlistCompat: true,
                onlyPluginIds: [configuredBundledPluginId],
            })
            : !hasCustomWebSearchPluginRisk(params.sourceConfig)
                ? resolveBundledPluginWebSearchProviders({
                    config: params.sourceConfig,
                    env: { ...process.env, ...params.context.env },
                    bundledAllowlistCompat: true,
                })
                : resolvePluginWebSearchProviders({
                    config: params.sourceConfig,
                    env: { ...process.env, ...params.context.env },
                    bundledAllowlistCompat: true,
                })
        : []);
    const configuredProvider = normalizeProvider(rawProvider, providers);
    if (rawProvider && !configuredProvider) {
        const diagnostic = {
            code: "WEB_SEARCH_PROVIDER_INVALID_AUTODETECT",
            message: `tools.web.search.provider is "${rawProvider}". Falling back to auto-detect precedence.`,
            path: "tools.web.search.provider",
        };
        diagnostics.push(diagnostic);
        searchMetadata.diagnostics.push(diagnostic);
        pushWarning(params.context, {
            code: "WEB_SEARCH_PROVIDER_INVALID_AUTODETECT",
            path: "tools.web.search.provider",
            message: diagnostic.message,
        });
    }
    if (configuredProvider) {
        searchMetadata.providerConfigured = configuredProvider;
        searchMetadata.providerSource = "configured";
    }
    if (searchEnabled) {
        const candidates = configuredProvider
            ? providers.filter((provider) => provider.id === configuredProvider)
            : providers;
        const unresolvedWithoutFallback = [];
        let selectedProvider;
        let selectedResolution;
        let keylessFallbackProvider;
        for (const provider of candidates) {
            if (provider.requiresCredential === false) {
                if (!keylessFallbackProvider) {
                    keylessFallbackProvider = provider;
                }
                if (configuredProvider) {
                    selectedProvider = provider.id;
                    break;
                }
                continue;
            }
            const path = keyPathForProvider(provider);
            const value = provider.getConfiguredCredentialValue?.(params.sourceConfig) ??
                provider.getCredentialValue(search);
            const resolution = await resolveSecretInputWithEnvFallback({
                sourceConfig: params.sourceConfig,
                context: params.context,
                defaults,
                value,
                path,
                envVars: provider.envVars,
            });
            if (resolution.secretRefConfigured && resolution.fallbackUsedAfterRefFailure) {
                const diagnostic = {
                    code: "WEB_SEARCH_KEY_UNRESOLVED_FALLBACK_USED",
                    message: `${path} SecretRef could not be resolved; using ${resolution.fallbackEnvVar ?? "env fallback"}. ` +
                        (resolution.unresolvedRefReason ?? "").trim(),
                    path,
                };
                diagnostics.push(diagnostic);
                searchMetadata.diagnostics.push(diagnostic);
                pushWarning(params.context, {
                    code: "WEB_SEARCH_KEY_UNRESOLVED_FALLBACK_USED",
                    path,
                    message: diagnostic.message,
                });
            }
            if (resolution.secretRefConfigured && !resolution.value && resolution.unresolvedRefReason) {
                unresolvedWithoutFallback.push({
                    provider: provider.id,
                    path,
                    reason: resolution.unresolvedRefReason,
                });
            }
            if (configuredProvider) {
                selectedProvider = provider.id;
                selectedResolution = resolution;
                if (resolution.value) {
                    setResolvedWebSearchApiKey({
                        resolvedConfig: params.resolvedConfig,
                        provider,
                        value: resolution.value,
                    });
                }
                break;
            }
            if (resolution.value) {
                selectedProvider = provider.id;
                selectedResolution = resolution;
                setResolvedWebSearchApiKey({
                    resolvedConfig: params.resolvedConfig,
                    provider,
                    value: resolution.value,
                });
                break;
            }
        }
        if (!selectedProvider && keylessFallbackProvider) {
            selectedProvider = keylessFallbackProvider.id;
            selectedResolution = {
                source: "missing",
                secretRefConfigured: false,
                fallbackUsedAfterRefFailure: false,
            };
        }
        const failUnresolvedSearchNoFallback = (unresolved) => {
            const diagnostic = {
                code: "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
                message: unresolved.reason,
                path: unresolved.path,
            };
            diagnostics.push(diagnostic);
            searchMetadata.diagnostics.push(diagnostic);
            pushWarning(params.context, {
                code: "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
                path: unresolved.path,
                message: unresolved.reason,
            });
            throw new Error(`[WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK] ${unresolved.reason}`);
        };
        if (configuredProvider) {
            const unresolved = unresolvedWithoutFallback[0];
            if (unresolved) {
                failUnresolvedSearchNoFallback(unresolved);
            }
        }
        else {
            if (!selectedProvider && unresolvedWithoutFallback.length > 0) {
                failUnresolvedSearchNoFallback(unresolvedWithoutFallback[0]);
            }
            if (selectedProvider) {
                const selectedProviderEntry = providers.find((entry) => entry.id === selectedProvider);
                const selectedDetails = selectedProviderEntry?.requiresCredential === false
                    ? `tools.web.search auto-detected keyless provider "${selectedProvider}" as the default fallback.`
                    : `tools.web.search auto-detected provider "${selectedProvider}" from available credentials.`;
                const diagnostic = {
                    code: "WEB_SEARCH_AUTODETECT_SELECTED",
                    message: selectedDetails,
                    path: "tools.web.search.provider",
                };
                diagnostics.push(diagnostic);
                searchMetadata.diagnostics.push(diagnostic);
            }
        }
        if (selectedProvider) {
            searchMetadata.selectedProvider = selectedProvider;
            searchMetadata.selectedProviderKeySource = selectedResolution?.source;
            if (!configuredProvider) {
                searchMetadata.providerSource = "auto-detect";
            }
            const provider = providers.find((entry) => entry.id === selectedProvider);
            if (provider?.resolveRuntimeMetadata) {
                Object.assign(searchMetadata, await provider.resolveRuntimeMetadata({
                    config: params.sourceConfig,
                    searchConfig: search,
                    runtimeMetadata: searchMetadata,
                    resolvedCredential: selectedResolution
                        ? {
                            value: selectedResolution.value,
                            source: selectedResolution.source,
                            fallbackEnvVar: selectedResolution.fallbackEnvVar,
                        }
                        : undefined,
                }));
            }
        }
    }
    if (searchEnabled && !configuredProvider && searchMetadata.selectedProvider) {
        for (const provider of providers) {
            if (provider.id === searchMetadata.selectedProvider) {
                continue;
            }
            const value = provider.getConfiguredCredentialValue?.(params.sourceConfig) ??
                provider.getCredentialValue(search);
            if (!hasConfiguredSecretRef(value, defaults)) {
                continue;
            }
            for (const path of inactivePathsForProvider(provider)) {
                pushInactiveSurfaceWarning({
                    context: params.context,
                    path,
                    details: `tools.web.search auto-detected provider is "${searchMetadata.selectedProvider}".`,
                });
            }
        }
    }
    else if (search && !searchEnabled) {
        for (const provider of providers) {
            const value = provider.getConfiguredCredentialValue?.(params.sourceConfig) ??
                provider.getCredentialValue(search);
            if (!hasConfiguredSecretRef(value, defaults)) {
                continue;
            }
            for (const path of inactivePathsForProvider(provider)) {
                pushInactiveSurfaceWarning({
                    context: params.context,
                    path,
                    details: "tools.web.search is disabled.",
                });
            }
        }
    }
    if (searchEnabled && search && configuredProvider) {
        for (const provider of providers) {
            if (provider.id === configuredProvider) {
                continue;
            }
            const value = provider.getConfiguredCredentialValue?.(params.sourceConfig) ??
                provider.getCredentialValue(search);
            if (!hasConfiguredSecretRef(value, defaults)) {
                continue;
            }
            for (const path of inactivePathsForProvider(provider)) {
                pushInactiveSurfaceWarning({
                    context: params.context,
                    path,
                    details: `tools.web.search.provider is "${configuredProvider}".`,
                });
            }
        }
    }
    const xSearch = isRecord(web?.x_search) ? web.x_search : undefined;
    const xSearchEnabled = xSearch?.enabled !== false;
    const xSearchPath = "tools.web.x_search.apiKey";
    let xSearchResolution = {
        source: "missing",
        secretRefConfigured: false,
        fallbackUsedAfterRefFailure: false,
    };
    const xSearchDiagnostics = [];
    if (xSearchEnabled) {
        xSearchResolution = await resolveSecretInputWithEnvFallback({
            sourceConfig: params.sourceConfig,
            context: params.context,
            defaults,
            value: xSearch?.apiKey,
            path: xSearchPath,
            envVars: ["XAI_API_KEY"],
        });
        if (xSearchResolution.value) {
            setResolvedXSearchApiKey({
                resolvedConfig: params.resolvedConfig,
                value: xSearchResolution.value,
            });
        }
        if (xSearchResolution.secretRefConfigured) {
            if (xSearchResolution.fallbackUsedAfterRefFailure) {
                const diagnostic = {
                    code: "WEB_X_SEARCH_KEY_UNRESOLVED_FALLBACK_USED",
                    message: `${xSearchPath} SecretRef could not be resolved; using ${xSearchResolution.fallbackEnvVar ?? "env fallback"}. ` +
                        (xSearchResolution.unresolvedRefReason ?? "").trim(),
                    path: xSearchPath,
                };
                diagnostics.push(diagnostic);
                xSearchDiagnostics.push(diagnostic);
                pushWarning(params.context, {
                    code: "WEB_X_SEARCH_KEY_UNRESOLVED_FALLBACK_USED",
                    path: xSearchPath,
                    message: diagnostic.message,
                });
            }
            if (!xSearchResolution.value && xSearchResolution.unresolvedRefReason) {
                const diagnostic = {
                    code: "WEB_X_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
                    message: xSearchResolution.unresolvedRefReason,
                    path: xSearchPath,
                };
                diagnostics.push(diagnostic);
                xSearchDiagnostics.push(diagnostic);
                pushWarning(params.context, {
                    code: "WEB_X_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
                    path: xSearchPath,
                    message: xSearchResolution.unresolvedRefReason,
                });
                throw new Error(`[WEB_X_SEARCH_KEY_UNRESOLVED_NO_FALLBACK] ${xSearchResolution.unresolvedRefReason}`);
            }
        }
    }
    else if (hasConfiguredSecretRef(xSearch?.apiKey, defaults)) {
        pushInactiveSurfaceWarning({
            context: params.context,
            path: xSearchPath,
            details: "tools.web.x_search is disabled.",
        });
        xSearchResolution = {
            source: "secretRef",
            secretRefConfigured: true,
            fallbackUsedAfterRefFailure: false,
        };
    }
    else {
        const configuredInlineValue = normalizeSecretInput(xSearch?.apiKey);
        if (configuredInlineValue) {
            xSearchResolution = {
                value: configuredInlineValue,
                source: "config",
                secretRefConfigured: false,
                fallbackUsedAfterRefFailure: false,
            };
        }
        else {
            const envFallback = readNonEmptyEnvValue(params.context.env, ["XAI_API_KEY"]);
            if (envFallback.value) {
                xSearchResolution = {
                    value: envFallback.value,
                    source: "env",
                    fallbackEnvVar: envFallback.envVar,
                    secretRefConfigured: false,
                    fallbackUsedAfterRefFailure: false,
                };
            }
        }
    }
    const fetch = isRecord(web?.fetch) ? web.fetch : undefined;
    const firecrawl = isRecord(fetch?.firecrawl) ? fetch.firecrawl : undefined;
    const fetchEnabled = fetch?.enabled !== false;
    const firecrawlEnabled = firecrawl?.enabled !== false;
    const firecrawlActive = Boolean(fetchEnabled && firecrawlEnabled);
    const firecrawlPath = "tools.web.fetch.firecrawl.apiKey";
    let firecrawlResolution = {
        source: "missing",
        secretRefConfigured: false,
        fallbackUsedAfterRefFailure: false,
    };
    const firecrawlDiagnostics = [];
    if (firecrawlActive) {
        firecrawlResolution = await resolveSecretInputWithEnvFallback({
            sourceConfig: params.sourceConfig,
            context: params.context,
            defaults,
            value: firecrawl?.apiKey,
            path: firecrawlPath,
            envVars: ["FIRECRAWL_API_KEY"],
        });
        if (firecrawlResolution.value) {
            setResolvedFirecrawlApiKey({
                resolvedConfig: params.resolvedConfig,
                value: firecrawlResolution.value,
            });
        }
        if (firecrawlResolution.secretRefConfigured) {
            if (firecrawlResolution.fallbackUsedAfterRefFailure) {
                const diagnostic = {
                    code: "WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_FALLBACK_USED",
                    message: `${firecrawlPath} SecretRef could not be resolved; using ${firecrawlResolution.fallbackEnvVar ?? "env fallback"}. ` +
                        (firecrawlResolution.unresolvedRefReason ?? "").trim(),
                    path: firecrawlPath,
                };
                diagnostics.push(diagnostic);
                firecrawlDiagnostics.push(diagnostic);
                pushWarning(params.context, {
                    code: "WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_FALLBACK_USED",
                    path: firecrawlPath,
                    message: diagnostic.message,
                });
            }
            if (!firecrawlResolution.value && firecrawlResolution.unresolvedRefReason) {
                const diagnostic = {
                    code: "WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_NO_FALLBACK",
                    message: firecrawlResolution.unresolvedRefReason,
                    path: firecrawlPath,
                };
                diagnostics.push(diagnostic);
                firecrawlDiagnostics.push(diagnostic);
                pushWarning(params.context, {
                    code: "WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_NO_FALLBACK",
                    path: firecrawlPath,
                    message: firecrawlResolution.unresolvedRefReason,
                });
                throw new Error(`[WEB_FETCH_FIRECRAWL_KEY_UNRESOLVED_NO_FALLBACK] ${firecrawlResolution.unresolvedRefReason}`);
            }
        }
    }
    else {
        if (hasConfiguredSecretRef(firecrawl?.apiKey, defaults)) {
            pushInactiveSurfaceWarning({
                context: params.context,
                path: firecrawlPath,
                details: !fetchEnabled
                    ? "tools.web.fetch is disabled."
                    : "tools.web.fetch.firecrawl.enabled is false.",
            });
            firecrawlResolution = {
                source: "secretRef",
                secretRefConfigured: true,
                fallbackUsedAfterRefFailure: false,
            };
        }
        else {
            const configuredInlineValue = normalizeSecretInput(firecrawl?.apiKey);
            if (configuredInlineValue) {
                firecrawlResolution = {
                    value: configuredInlineValue,
                    source: "config",
                    secretRefConfigured: false,
                    fallbackUsedAfterRefFailure: false,
                };
            }
            else {
                const envFallback = readNonEmptyEnvValue(params.context.env, ["FIRECRAWL_API_KEY"]);
                if (envFallback.value) {
                    firecrawlResolution = {
                        value: envFallback.value,
                        source: "env",
                        fallbackEnvVar: envFallback.envVar,
                        secretRefConfigured: false,
                        fallbackUsedAfterRefFailure: false,
                    };
                }
            }
        }
    }
    return {
        search: searchMetadata,
        xSearch: {
            active: Boolean(xSearchEnabled && xSearchResolution.value),
            apiKeySource: xSearchResolution.source,
            diagnostics: xSearchDiagnostics,
        },
        fetch: {
            firecrawl: {
                active: firecrawlActive,
                apiKeySource: firecrawlResolution.source,
                diagnostics: firecrawlDiagnostics,
            },
        },
        diagnostics,
    };
}
