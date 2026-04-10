import { resolveProviderAuthAliasMap } from "../agents/provider-auth-aliases.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
const CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES = {
    voyage: ["VOYAGE_API_KEY"],
    cerebras: ["CEREBRAS_API_KEY"],
    "anthropic-openai": ["ANTHROPIC_API_KEY"],
    "qwen-dashscope": ["DASHSCOPE_API_KEY"],
};
const CORE_PROVIDER_SETUP_ENV_VAR_OVERRIDES = {
    "minimax-cn": ["MINIMAX_API_KEY"],
};
function appendUniqueEnvVarCandidates(target, providerId, keys) {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId || keys.length === 0) {
        return;
    }
    const bucket = (target[normalizedProviderId] ??= []);
    const seen = new Set(bucket);
    for (const key of keys) {
        const normalizedKey = key.trim();
        if (!normalizedKey || seen.has(normalizedKey)) {
            continue;
        }
        seen.add(normalizedKey);
        bucket.push(normalizedKey);
    }
}
function resolveManifestProviderAuthEnvVarCandidates(params) {
    const registry = loadPluginManifestRegistry({
        config: params?.config,
        workspaceDir: params?.workspaceDir,
        env: params?.env,
    });
    const candidates = Object.create(null);
    for (const plugin of registry.plugins) {
        if (!plugin.providerAuthEnvVars) {
            continue;
        }
        for (const [providerId, keys] of Object.entries(plugin.providerAuthEnvVars).toSorted(([left], [right]) => left.localeCompare(right))) {
            appendUniqueEnvVarCandidates(candidates, providerId, keys);
        }
    }
    const aliases = resolveProviderAuthAliasMap(params);
    for (const [alias, target] of Object.entries(aliases).toSorted(([left], [right]) => left.localeCompare(right))) {
        const keys = candidates[target];
        if (keys) {
            appendUniqueEnvVarCandidates(candidates, alias, keys);
        }
    }
    return candidates;
}
export function resolveProviderAuthEnvVarCandidates(params) {
    return {
        ...resolveManifestProviderAuthEnvVarCandidates(params),
        ...CORE_PROVIDER_AUTH_ENV_VAR_CANDIDATES,
    };
}
export function resolveProviderEnvVars(params) {
    return {
        ...resolveProviderAuthEnvVarCandidates(params),
        ...CORE_PROVIDER_SETUP_ENV_VAR_OVERRIDES,
    };
}
/**
 * Provider auth env candidates used by generic auth resolution.
 *
 * Order matters: the first non-empty value wins for helpers such as
 * `resolveEnvApiKey()`. Bundled providers source this from plugin manifest
 * metadata so auth probes do not need to load plugin runtime.
 */
export const PROVIDER_AUTH_ENV_VAR_CANDIDATES = {
    ...resolveProviderAuthEnvVarCandidates(),
};
/**
 * Provider env vars used for setup/default secret refs and broad secret
 * scrubbing. This can include non-model providers and may intentionally choose
 * a different preferred first env var than auth resolution.
 *
 * Bundled provider auth envs come from plugin manifests. The override map here
 * is only for true core/non-plugin providers and a few setup-specific ordering
 * overrides where generic onboarding wants a different preferred env var.
 */
export const PROVIDER_ENV_VARS = {
    ...resolveProviderEnvVars(),
};
export function getProviderEnvVars(providerId, params) {
    const providerEnvVars = resolveProviderEnvVars(params);
    const envVars = Object.hasOwn(providerEnvVars, providerId)
        ? providerEnvVars[providerId]
        : undefined;
    return Array.isArray(envVars) ? [...envVars] : [];
}
const EXTRA_PROVIDER_AUTH_ENV_VARS = ["MINIMAX_CODE_PLAN_KEY", "MINIMAX_CODING_API_KEY"];
// OPENCLAW_API_KEY authenticates the local OpenClaw bridge itself and must
// remain available to child bridge/runtime processes.
export function listKnownProviderAuthEnvVarNames(params) {
    return [
        ...new Set([
            ...Object.values(resolveProviderAuthEnvVarCandidates(params)).flatMap((keys) => keys),
            ...Object.values(resolveProviderEnvVars(params)).flatMap((keys) => keys),
            ...EXTRA_PROVIDER_AUTH_ENV_VARS,
        ]),
    ];
}
export function listKnownSecretEnvVarNames(params) {
    return [...new Set(Object.values(resolveProviderEnvVars(params)).flatMap((keys) => keys))];
}
export function omitEnvKeysCaseInsensitive(baseEnv, keys) {
    const env = { ...baseEnv };
    const denied = new Set();
    for (const key of keys) {
        const normalizedKey = key.trim();
        if (normalizedKey) {
            denied.add(normalizedKey.toUpperCase());
        }
    }
    if (denied.size === 0) {
        return env;
    }
    for (const actualKey of Object.keys(env)) {
        if (denied.has(actualKey.toUpperCase())) {
            delete env[actualKey];
        }
    }
    return env;
}
