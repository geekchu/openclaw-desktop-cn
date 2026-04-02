import { coerceSecretRef, resolveSecretInputRef } from "../config/types.secrets.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveProviderWebSearchPluginConfig } from "../plugin-sdk/provider-web-search.js";
import { resolveProviderSyntheticAuthWithPlugin } from "../plugins/provider-runtime.js";
import { normalizeOptionalSecretInput } from "../utils/normalize-secret-input.js";
import { listProfilesForProvider } from "./auth-profiles/profiles.js";
import { resolveEnvApiKey } from "./model-auth-env.js";
import { isNonSecretApiKeyMarker, resolveEnvSecretRefHeaderValueMarker, resolveNonEnvSecretRefApiKeyMarker, resolveNonEnvSecretRefHeaderValueMarker, } from "./model-auth-markers.js";
import { resolveAwsSdkEnvVarName } from "./model-auth-runtime-shared.js";
import { shouldTraceProviderAuth, summarizeProviderAuthKey } from "./xai-auth-trace.js";
const ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const log = createSubsystemLogger("agents/model-providers");
export function normalizeApiKeyConfig(value) {
    const trimmed = value.trim();
    const match = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
    return match?.[1] ?? trimmed;
}
export function toDiscoveryApiKey(value) {
    const trimmed = value?.trim();
    if (!trimmed || isNonSecretApiKeyMarker(trimmed)) {
        return undefined;
    }
    return trimmed;
}
export function resolveEnvApiKeyVarName(provider, env = process.env) {
    const resolved = resolveEnvApiKey(provider, env);
    if (!resolved) {
        return undefined;
    }
    const match = /^(?:env: |shell env: )([A-Z0-9_]+)$/.exec(resolved.source);
    return match ? match[1] : undefined;
}
export function resolveAwsSdkApiKeyVarName(env = process.env) {
    return resolveAwsSdkEnvVarName(env) ?? "AWS_PROFILE";
}
export function normalizeHeaderValues(params) {
    const { headers } = params;
    if (!headers) {
        return { headers, mutated: false };
    }
    let mutated = false;
    const nextHeaders = {};
    for (const [headerName, headerValue] of Object.entries(headers)) {
        const resolvedRef = resolveSecretInputRef({
            value: headerValue,
            defaults: params.secretDefaults,
        }).ref;
        if (!resolvedRef || !resolvedRef.id.trim()) {
            nextHeaders[headerName] = headerValue;
            continue;
        }
        mutated = true;
        nextHeaders[headerName] =
            resolvedRef.source === "env"
                ? resolveEnvSecretRefHeaderValueMarker(resolvedRef.id)
                : resolveNonEnvSecretRefHeaderValueMarker(resolvedRef.source);
    }
    if (!mutated) {
        return { headers, mutated: false };
    }
    return { headers: nextHeaders, mutated: true };
}
export function resolveApiKeyFromCredential(cred, env = process.env) {
    if (!cred) {
        return undefined;
    }
    if (cred.type === "api_key") {
        const keyRef = coerceSecretRef(cred.keyRef);
        if (keyRef && keyRef.id.trim()) {
            if (keyRef.source === "env") {
                const envVar = keyRef.id.trim();
                return {
                    apiKey: envVar,
                    source: "env-ref",
                    discoveryApiKey: toDiscoveryApiKey(env[envVar]),
                };
            }
            return {
                apiKey: resolveNonEnvSecretRefApiKeyMarker(keyRef.source),
                source: "non-env-ref",
            };
        }
        if (cred.key?.trim()) {
            return {
                apiKey: cred.key,
                source: "plaintext",
                discoveryApiKey: toDiscoveryApiKey(cred.key),
            };
        }
        return undefined;
    }
    if (cred.type === "token") {
        const tokenRef = coerceSecretRef(cred.tokenRef);
        if (tokenRef && tokenRef.id.trim()) {
            if (tokenRef.source === "env") {
                const envVar = tokenRef.id.trim();
                return {
                    apiKey: envVar,
                    source: "env-ref",
                    discoveryApiKey: toDiscoveryApiKey(env[envVar]),
                };
            }
            return {
                apiKey: resolveNonEnvSecretRefApiKeyMarker(tokenRef.source),
                source: "non-env-ref",
            };
        }
        if (cred.token?.trim()) {
            return {
                apiKey: cred.token,
                source: "plaintext",
                discoveryApiKey: toDiscoveryApiKey(cred.token),
            };
        }
    }
    return undefined;
}
export function resolveApiKeyFromProfiles(params) {
    const ids = listProfilesForProvider(params.store, params.provider);
    for (const id of ids) {
        const resolved = resolveApiKeyFromCredential(params.store.profiles[id], params.env);
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
}
export function normalizeConfiguredProviderApiKey(params) {
    const configuredApiKey = params.provider.apiKey;
    const configuredApiKeyRef = resolveSecretInputRef({
        value: configuredApiKey,
        defaults: params.secretDefaults,
    }).ref;
    if (configuredApiKeyRef && configuredApiKeyRef.id.trim()) {
        const marker = configuredApiKeyRef.source === "env"
            ? configuredApiKeyRef.id.trim()
            : resolveNonEnvSecretRefApiKeyMarker(configuredApiKeyRef.source);
        params.secretRefManagedProviders?.add(params.providerKey);
        if (params.provider.apiKey === marker) {
            return params.provider;
        }
        return {
            ...params.provider,
            apiKey: marker,
        };
    }
    if (typeof configuredApiKey !== "string") {
        return params.provider;
    }
    const normalizedConfiguredApiKey = normalizeApiKeyConfig(configuredApiKey);
    if (isNonSecretApiKeyMarker(normalizedConfiguredApiKey)) {
        params.secretRefManagedProviders?.add(params.providerKey);
    }
    if (params.profileApiKey &&
        params.profileApiKey.source !== "plaintext" &&
        normalizedConfiguredApiKey === params.profileApiKey.apiKey) {
        params.secretRefManagedProviders?.add(params.providerKey);
    }
    if (normalizedConfiguredApiKey === configuredApiKey) {
        return params.provider;
    }
    return {
        ...params.provider,
        apiKey: normalizedConfiguredApiKey,
    };
}
export function normalizeResolvedEnvApiKey(params) {
    const currentApiKey = params.provider.apiKey;
    if (typeof currentApiKey !== "string" ||
        !currentApiKey.trim() ||
        ENV_VAR_NAME_RE.test(currentApiKey.trim())) {
        return params.provider;
    }
    const envVarName = resolveEnvApiKeyVarName(params.providerKey, params.env);
    if (!envVarName || params.env[envVarName] !== currentApiKey) {
        return params.provider;
    }
    params.secretRefManagedProviders?.add(params.providerKey);
    return {
        ...params.provider,
        apiKey: envVarName,
    };
}
export function resolveMissingProviderApiKey(params) {
    const hasModels = Array.isArray(params.provider.models) && params.provider.models.length > 0;
    const normalizedApiKey = normalizeOptionalSecretInput(params.provider.apiKey);
    const hasConfiguredApiKey = Boolean(normalizedApiKey || params.provider.apiKey);
    if (!hasModels || hasConfiguredApiKey) {
        return params.provider;
    }
    const authMode = params.provider.auth;
    if (params.providerApiKeyResolver && (!authMode || authMode === "aws-sdk")) {
        return {
            ...params.provider,
            apiKey: params.providerApiKeyResolver(params.env),
        };
    }
    if (authMode === "aws-sdk") {
        return {
            ...params.provider,
            apiKey: resolveAwsSdkApiKeyVarName(params.env),
        };
    }
    const fromEnv = resolveEnvApiKeyVarName(params.providerKey, params.env);
    const apiKey = fromEnv ?? params.profileApiKey?.apiKey;
    if (!apiKey?.trim()) {
        return params.provider;
    }
    if (params.profileApiKey && params.profileApiKey.source !== "plaintext") {
        params.secretRefManagedProviders?.add(params.providerKey);
    }
    return {
        ...params.provider,
        apiKey,
    };
}
export function createProviderApiKeyResolver(env, authStore, config) {
    return (provider) => {
        const envVar = resolveEnvApiKeyVarName(provider, env);
        if (envVar) {
            return {
                apiKey: envVar,
                discoveryApiKey: toDiscoveryApiKey(env[envVar]),
            };
        }
        const fromProfiles = resolveApiKeyFromProfiles({ provider, store: authStore, env });
        if (fromProfiles?.apiKey) {
            return {
                apiKey: fromProfiles.apiKey,
                discoveryApiKey: fromProfiles.discoveryApiKey,
            };
        }
        const fromConfig = resolveConfigBackedProviderAuth({
            provider,
            config,
        });
        return {
            apiKey: fromConfig?.apiKey,
            discoveryApiKey: fromConfig?.discoveryApiKey,
        };
    };
}
export function createProviderAuthResolver(env, authStore, config) {
    return (provider, options) => {
        const ids = listProfilesForProvider(authStore, provider);
        let oauthCandidate;
        for (const id of ids) {
            const cred = authStore.profiles[id];
            if (!cred) {
                continue;
            }
            if (cred.type === "oauth") {
                oauthCandidate ??= {
                    apiKey: options?.oauthMarker,
                    discoveryApiKey: toDiscoveryApiKey(cred.access),
                    mode: "oauth",
                    source: "profile",
                    profileId: id,
                };
                continue;
            }
            const resolved = resolveApiKeyFromCredential(cred, env);
            if (!resolved) {
                continue;
            }
            return {
                apiKey: resolved.apiKey,
                discoveryApiKey: resolved.discoveryApiKey,
                mode: cred.type,
                source: "profile",
                profileId: id,
            };
        }
        if (oauthCandidate) {
            return oauthCandidate;
        }
        const envVar = resolveEnvApiKeyVarName(provider, env);
        if (envVar) {
            return {
                apiKey: envVar,
                discoveryApiKey: toDiscoveryApiKey(env[envVar]),
                mode: "api_key",
                source: "env",
            };
        }
        const fromConfig = resolveConfigBackedProviderAuth({
            provider,
            config,
        });
        if (fromConfig) {
            return {
                apiKey: fromConfig.apiKey,
                discoveryApiKey: fromConfig.discoveryApiKey,
                mode: fromConfig.mode,
                source: "none",
            };
        }
        return {
            apiKey: undefined,
            discoveryApiKey: undefined,
            mode: "none",
            source: "none",
        };
    };
}
function resolveConfigBackedProviderAuth(params) {
    // Providers own any provider-specific fallback auth logic via
    // resolveSyntheticAuth(...). Discovery/bootstrap callers may consume
    // non-secret markers from source config, but must never persist plaintext.
    const synthetic = resolveProviderSyntheticAuthWithPlugin({
        provider: params.provider,
        config: params.config,
        context: {
            config: params.config,
            provider: params.provider,
            providerConfig: params.config?.models?.providers?.[params.provider],
        },
    }) ?? resolveXaiConfigFallbackAuth(params);
    const apiKey = synthetic?.apiKey?.trim();
    if (!apiKey) {
        if (shouldTraceProviderAuth(params.provider)) {
            log.info("[xai-auth] bootstrap config fallback: no config-backed key found");
        }
        return undefined;
    }
    if (shouldTraceProviderAuth(params.provider)) {
        log.info(`[xai-auth] bootstrap config fallback: key=${summarizeProviderAuthKey(apiKey)} marker=${isNonSecretApiKeyMarker(apiKey) ? "kept" : "secretref-managed"} source=config`);
    }
    return isNonSecretApiKeyMarker(apiKey)
        ? {
            apiKey,
            discoveryApiKey: toDiscoveryApiKey(apiKey),
            mode: "api_key",
            source: "config",
        }
        : {
            apiKey: resolveNonEnvSecretRefApiKeyMarker("file"),
            discoveryApiKey: toDiscoveryApiKey(apiKey),
            mode: "api_key",
            source: "config",
        };
}
function resolveXaiConfigFallbackAuth(params) {
    if (params.provider.trim().toLowerCase() !== "xai") {
        return undefined;
    }
    const xaiPluginEntry = params.config?.plugins?.entries?.xai;
    if (xaiPluginEntry?.enabled === false) {
        return undefined;
    }
    const pluginApiKey = normalizeOptionalSecretInput(resolveProviderWebSearchPluginConfig(params.config, "xai")?.apiKey);
    if (pluginApiKey) {
        return {
            apiKey: pluginApiKey,
            source: "plugins.entries.xai.config.webSearch.apiKey",
            mode: "api-key",
        };
    }
    const pluginApiKeyRef = coerceSecretRef(resolveProviderWebSearchPluginConfig(params.config, "xai")?.apiKey);
    if (pluginApiKeyRef) {
        return {
            apiKey: pluginApiKeyRef.source === "env"
                ? pluginApiKeyRef.id.trim()
                : resolveNonEnvSecretRefApiKeyMarker(pluginApiKeyRef.source),
            source: "plugins.entries.xai.config.webSearch.apiKey",
            mode: "api-key",
        };
    }
    const grokApiKey = normalizeOptionalSecretInput(params.config?.tools?.web?.search?.grok?.apiKey);
    if (grokApiKey) {
        return {
            apiKey: grokApiKey,
            source: "tools.web.search.grok.apiKey",
            mode: "api-key",
        };
    }
    const grokApiKeyRef = coerceSecretRef(params.config?.tools?.web?.search?.grok?.apiKey);
    if (!grokApiKeyRef) {
        return undefined;
    }
    return {
        apiKey: grokApiKeyRef.source === "env"
            ? grokApiKeyRef.id.trim()
            : resolveNonEnvSecretRefApiKeyMarker(grokApiKeyRef.source),
        source: "tools.web.search.grok.apiKey",
        mode: "api-key",
    };
}
