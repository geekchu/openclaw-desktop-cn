import { resolveThinkingDefaultForModel } from "../auto-reply/thinking.shared.js";
import { resolveAgentModelFallbackValues, resolveAgentModelPrimaryValue, toAgentModelListLike, } from "../config/model-input.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeGoogleModelId } from "../plugin-sdk/google.js";
import { normalizeXaiModelId } from "../plugin-sdk/xai.js";
import { sanitizeForLog } from "../terminal/ansi.js";
import { resolveAgentConfig, resolveAgentEffectiveModelPrimary, resolveAgentModelFallbacksOverride, } from "./agent-scope.js";
import { resolveConfiguredProviderFallback } from "./configured-provider-fallback.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import { splitTrailingAuthProfile } from "./model-ref-profile.js";
import { findNormalizedProviderKey, findNormalizedProviderValue, normalizeProviderId, normalizeProviderIdForAuth, } from "./provider-id.js";
import { normalizeProviderModelIdWithRuntime } from "./provider-model-normalization.runtime.js";
let log = null;
const CLI_BACKEND_RUNTIME_CANDIDATES = [
    "../plugins/cli-backends.runtime.js",
    "../plugins/cli-backends.runtime.ts",
];
let cliBackendRuntimeModule;
function loadCliBackendRuntime() {
    if (cliBackendRuntimeModule) {
        return cliBackendRuntimeModule;
    }
    for (const candidate of CLI_BACKEND_RUNTIME_CANDIDATES) {
        try {
            cliBackendRuntimeModule = require(candidate);
            return cliBackendRuntimeModule;
        }
        catch {
            // Try source/runtime candidates in order.
        }
    }
    return null;
}
function getLog() {
    log ??= createSubsystemLogger("model-selection");
    return log;
}
function normalizeAliasKey(value) {
    return value.trim().toLowerCase();
}
export function modelKey(provider, model) {
    const providerId = provider.trim();
    const modelId = model.trim();
    if (!providerId) {
        return modelId;
    }
    if (!modelId) {
        return providerId;
    }
    return modelId.toLowerCase().startsWith(`${providerId.toLowerCase()}/`)
        ? modelId
        : `${providerId}/${modelId}`;
}
export function legacyModelKey(provider, model) {
    const providerId = provider.trim();
    const modelId = model.trim();
    if (!providerId || !modelId) {
        return null;
    }
    const rawKey = `${providerId}/${modelId}`;
    const canonicalKey = modelKey(providerId, modelId);
    return rawKey === canonicalKey ? null : rawKey;
}
export { findNormalizedProviderKey, findNormalizedProviderValue, normalizeProviderId, normalizeProviderIdForAuth, };
export function isCliProvider(provider, cfg) {
    const normalized = normalizeProviderId(provider);
    const cliBackends = loadCliBackendRuntime()?.resolveRuntimeCliBackends() ?? [];
    if (cliBackends.some((backend) => normalizeProviderId(backend.id) === normalized)) {
        return true;
    }
    const backends = cfg?.agents?.defaults?.cliBackends ?? {};
    return Object.keys(backends).some((key) => normalizeProviderId(key) === normalized);
}
function normalizeAnthropicModelId(model) {
    const trimmed = model.trim();
    if (!trimmed) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    // Keep alias resolution local so bundled startup paths cannot trip a TDZ on
    // a module-level alias table while config parsing is still initializing.
    switch (lower) {
        case "opus-4.6":
            return "claude-opus-4-6";
        case "opus-4.5":
            return "claude-opus-4-5";
        case "sonnet-4.6":
            return "claude-sonnet-4-6";
        case "sonnet-4.5":
            return "claude-sonnet-4-5";
        default:
            return trimmed;
    }
}
function normalizeProviderModelId(provider, model) {
    if (provider === "anthropic") {
        return normalizeAnthropicModelId(model);
    }
    if (provider === "google" || provider === "google-vertex") {
        return normalizeGoogleModelId(model);
    }
    if (provider === "openai") {
        return model;
    }
    if (provider === "openrouter") {
        return model.includes("/") ? model : `openrouter/${model}`;
    }
    if (provider === "xai") {
        return normalizeXaiModelId(model);
    }
    if (provider === "vercel-ai-gateway" && !model.includes("/")) {
        // Allow Vercel-specific Claude refs without an upstream prefix.
        const normalizedAnthropicModel = normalizeAnthropicModelId(model);
        if (normalizedAnthropicModel.startsWith("claude-")) {
            return `anthropic/${normalizedAnthropicModel}`;
        }
    }
    return (normalizeProviderModelIdWithRuntime({
        provider,
        context: {
            provider,
            modelId: model,
        },
    }) ?? model);
}
export function normalizeModelRef(provider, model, options) {
    const normalizedProvider = normalizeProviderId(provider);
    const normalizedModel = options?.allowPluginNormalization === false
        ? model.trim()
        : normalizeProviderModelId(normalizedProvider, model.trim());
    return { provider: normalizedProvider, model: normalizedModel };
}
export function parseModelRef(raw, defaultProvider, options) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    const slash = trimmed.indexOf("/");
    if (slash === -1) {
        return normalizeModelRef(defaultProvider, trimmed, options);
    }
    const providerRaw = trimmed.slice(0, slash).trim();
    const model = trimmed.slice(slash + 1).trim();
    if (!providerRaw || !model) {
        return null;
    }
    return normalizeModelRef(providerRaw, model, options);
}
export function inferUniqueProviderFromConfiguredModels(params) {
    const model = params.model.trim();
    if (!model) {
        return undefined;
    }
    const configuredModels = params.cfg.agents?.defaults?.models;
    if (!configuredModels) {
        return undefined;
    }
    const normalized = model.toLowerCase();
    const providers = new Set();
    for (const key of Object.keys(configuredModels)) {
        const ref = key.trim();
        if (!ref || !ref.includes("/")) {
            continue;
        }
        const parsed = parseModelRef(ref, DEFAULT_PROVIDER, {
            allowPluginNormalization: false,
        });
        if (!parsed) {
            continue;
        }
        if (parsed.model === model || parsed.model.toLowerCase() === normalized) {
            providers.add(parsed.provider);
            if (providers.size > 1) {
                return undefined;
            }
        }
    }
    if (providers.size !== 1) {
        return undefined;
    }
    return providers.values().next().value;
}
export function resolveAllowlistModelKey(raw, defaultProvider) {
    const parsed = parseModelRef(raw, defaultProvider);
    if (!parsed) {
        return null;
    }
    return modelKey(parsed.provider, parsed.model);
}
export function buildConfiguredAllowlistKeys(params) {
    const rawAllowlist = Object.keys(params.cfg?.agents?.defaults?.models ?? {});
    if (rawAllowlist.length === 0) {
        return null;
    }
    const keys = new Set();
    for (const raw of rawAllowlist) {
        const key = resolveAllowlistModelKey(String(raw ?? ""), params.defaultProvider);
        if (key) {
            keys.add(key);
        }
    }
    return keys.size > 0 ? keys : null;
}
export function buildModelAliasIndex(params) {
    const byAlias = new Map();
    const byKey = new Map();
    const rawModels = params.cfg.agents?.defaults?.models ?? {};
    for (const [keyRaw, entryRaw] of Object.entries(rawModels)) {
        const parsed = parseModelRef(String(keyRaw ?? ""), params.defaultProvider, {
            allowPluginNormalization: params.allowPluginNormalization,
        });
        if (!parsed) {
            continue;
        }
        const alias = String(entryRaw?.alias ?? "").trim();
        if (!alias) {
            continue;
        }
        const aliasKey = normalizeAliasKey(alias);
        byAlias.set(aliasKey, { alias, ref: parsed });
        const key = modelKey(parsed.provider, parsed.model);
        const existing = byKey.get(key) ?? [];
        existing.push(alias);
        byKey.set(key, existing);
    }
    return { byAlias, byKey };
}
export function resolveModelRefFromString(params) {
    const { model } = splitTrailingAuthProfile(params.raw);
    if (!model) {
        return null;
    }
    if (!model.includes("/")) {
        const aliasKey = normalizeAliasKey(model);
        const aliasMatch = params.aliasIndex?.byAlias.get(aliasKey);
        if (aliasMatch) {
            return { ref: aliasMatch.ref, alias: aliasMatch.alias };
        }
    }
    const parsed = parseModelRef(model, params.defaultProvider, {
        allowPluginNormalization: params.allowPluginNormalization,
    });
    if (!parsed) {
        return null;
    }
    return { ref: parsed };
}
export function resolveConfiguredModelRef(params) {
    const rawModel = resolveAgentModelPrimaryValue(params.cfg.agents?.defaults?.model) ?? "";
    if (rawModel) {
        const trimmed = rawModel.trim();
        const aliasIndex = buildModelAliasIndex({
            cfg: params.cfg,
            defaultProvider: params.defaultProvider,
            allowPluginNormalization: params.allowPluginNormalization,
        });
        if (!trimmed.includes("/")) {
            const aliasKey = normalizeAliasKey(trimmed);
            const aliasMatch = aliasIndex.byAlias.get(aliasKey);
            if (aliasMatch) {
                return aliasMatch.ref;
            }
            // Default to anthropic if no provider is specified, but warn as this is deprecated.
            const safeTrimmed = sanitizeForLog(trimmed);
            getLog().warn(`Model "${safeTrimmed}" specified without provider. Falling back to "anthropic/${safeTrimmed}". Please use "anthropic/${safeTrimmed}" in your config.`);
            return { provider: "anthropic", model: trimmed };
        }
        const resolved = resolveModelRefFromString({
            raw: trimmed,
            defaultProvider: params.defaultProvider,
            aliasIndex,
            allowPluginNormalization: params.allowPluginNormalization,
        });
        if (resolved) {
            return resolved.ref;
        }
        // User specified a model but it could not be resolved — warn before falling back.
        const safe = sanitizeForLog(trimmed);
        const safeFallback = sanitizeForLog(`${params.defaultProvider}/${params.defaultModel}`);
        getLog().warn(`Model "${safe}" could not be resolved. Falling back to default "${safeFallback}".`);
    }
    // Before falling back to the hardcoded default, check if the default provider
    // is actually available. If it isn't but other providers are configured, prefer
    // the first configured provider's first model to avoid reporting a stale default
    // from a removed provider. (See #38880)
    const fallbackProvider = resolveConfiguredProviderFallback({
        cfg: params.cfg,
        defaultProvider: params.defaultProvider,
    });
    if (fallbackProvider) {
        return fallbackProvider;
    }
    return { provider: params.defaultProvider, model: params.defaultModel };
}
export function resolveDefaultModelForAgent(params) {
    const agentModelOverride = params.agentId
        ? resolveAgentEffectiveModelPrimary(params.cfg, params.agentId)
        : undefined;
    const cfg = agentModelOverride && agentModelOverride.length > 0
        ? {
            ...params.cfg,
            agents: {
                ...params.cfg.agents,
                defaults: {
                    ...params.cfg.agents?.defaults,
                    model: {
                        ...toAgentModelListLike(params.cfg.agents?.defaults?.model),
                        primary: agentModelOverride,
                    },
                },
            },
        }
        : params.cfg;
    return resolveConfiguredModelRef({
        cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
    });
}
function resolveAllowedFallbacks(params) {
    if (params.agentId) {
        const override = resolveAgentModelFallbacksOverride(params.cfg, params.agentId);
        if (override !== undefined) {
            return override;
        }
    }
    return resolveAgentModelFallbackValues(params.cfg.agents?.defaults?.model);
}
export function resolveSubagentConfiguredModelSelection(params) {
    const agentConfig = resolveAgentConfig(params.cfg, params.agentId);
    return (normalizeModelSelection(agentConfig?.subagents?.model) ??
        normalizeModelSelection(params.cfg.agents?.defaults?.subagents?.model) ??
        normalizeModelSelection(agentConfig?.model));
}
export function resolveSubagentSpawnModelSelection(params) {
    const runtimeDefault = resolveDefaultModelForAgent({
        cfg: params.cfg,
        agentId: params.agentId,
    });
    return (normalizeModelSelection(params.modelOverride) ??
        resolveSubagentConfiguredModelSelection({
            cfg: params.cfg,
            agentId: params.agentId,
        }) ??
        normalizeModelSelection(resolveAgentModelPrimaryValue(params.cfg.agents?.defaults?.model)) ??
        `${runtimeDefault.provider}/${runtimeDefault.model}`);
}
export function buildAllowedModelSet(params) {
    const rawAllowlist = (() => {
        const modelMap = params.cfg.agents?.defaults?.models ?? {};
        return Object.keys(modelMap);
    })();
    const allowAny = rawAllowlist.length === 0;
    const defaultModel = params.defaultModel?.trim();
    const defaultRef = defaultModel && params.defaultProvider
        ? parseModelRef(defaultModel, params.defaultProvider)
        : null;
    const defaultKey = defaultRef ? modelKey(defaultRef.provider, defaultRef.model) : undefined;
    const catalogKeys = new Set(params.catalog.map((entry) => modelKey(entry.provider, entry.id)));
    if (allowAny) {
        if (defaultKey) {
            catalogKeys.add(defaultKey);
        }
        return {
            allowAny: true,
            allowedCatalog: params.catalog,
            allowedKeys: catalogKeys,
        };
    }
    const allowedKeys = new Set();
    const syntheticCatalogEntries = new Map();
    for (const raw of rawAllowlist) {
        const parsed = parseModelRef(String(raw), params.defaultProvider);
        if (!parsed) {
            continue;
        }
        const key = modelKey(parsed.provider, parsed.model);
        // Explicit allowlist entries are always trusted, even when bundled catalog
        // data is stale and does not include the configured model yet.
        allowedKeys.add(key);
        if (!catalogKeys.has(key) && !syntheticCatalogEntries.has(key)) {
            syntheticCatalogEntries.set(key, {
                id: parsed.model,
                name: parsed.model,
                provider: parsed.provider,
            });
        }
    }
    for (const fallback of resolveAllowedFallbacks({
        cfg: params.cfg,
        agentId: params.agentId,
    })) {
        const parsed = parseModelRef(String(fallback), params.defaultProvider);
        if (parsed) {
            const key = modelKey(parsed.provider, parsed.model);
            allowedKeys.add(key);
            if (!catalogKeys.has(key) && !syntheticCatalogEntries.has(key)) {
                syntheticCatalogEntries.set(key, {
                    id: parsed.model,
                    name: parsed.model,
                    provider: parsed.provider,
                });
            }
        }
    }
    if (defaultKey) {
        allowedKeys.add(defaultKey);
    }
    const allowedCatalog = [
        ...params.catalog.filter((entry) => allowedKeys.has(modelKey(entry.provider, entry.id))),
        ...syntheticCatalogEntries.values(),
    ];
    if (allowedCatalog.length === 0 && allowedKeys.size === 0) {
        if (defaultKey) {
            catalogKeys.add(defaultKey);
        }
        return {
            allowAny: true,
            allowedCatalog: params.catalog,
            allowedKeys: catalogKeys,
        };
    }
    return { allowAny: false, allowedCatalog, allowedKeys };
}
export function buildConfiguredModelCatalog(params) {
    const providers = params.cfg.models?.providers;
    if (!providers || typeof providers !== "object") {
        return [];
    }
    const catalog = [];
    for (const [providerRaw, provider] of Object.entries(providers)) {
        const providerId = normalizeProviderId(providerRaw);
        if (!providerId || !Array.isArray(provider?.models)) {
            continue;
        }
        for (const model of provider.models) {
            const id = typeof model?.id === "string" ? model.id.trim() : "";
            if (!id) {
                continue;
            }
            const name = typeof model?.name === "string" && model.name.trim() ? model.name.trim() : id;
            const contextWindow = typeof model?.contextWindow === "number" && model.contextWindow > 0
                ? model.contextWindow
                : undefined;
            const reasoning = typeof model?.reasoning === "boolean" ? model.reasoning : undefined;
            const input = Array.isArray(model?.input) ? model.input : undefined;
            catalog.push({
                provider: providerId,
                id,
                name,
                contextWindow,
                reasoning,
                input,
            });
        }
    }
    return catalog;
}
export function getModelRefStatus(params) {
    const allowed = buildAllowedModelSet({
        cfg: params.cfg,
        catalog: params.catalog,
        defaultProvider: params.defaultProvider,
        defaultModel: params.defaultModel,
    });
    const key = modelKey(params.ref.provider, params.ref.model);
    return {
        key,
        inCatalog: params.catalog.some((entry) => modelKey(entry.provider, entry.id) === key),
        allowAny: allowed.allowAny,
        allowed: allowed.allowAny || allowed.allowedKeys.has(key),
    };
}
export function resolveAllowedModelRef(params) {
    const trimmed = params.raw.trim();
    if (!trimmed) {
        return { error: "invalid model: empty" };
    }
    const aliasIndex = buildModelAliasIndex({
        cfg: params.cfg,
        defaultProvider: params.defaultProvider,
    });
    const resolved = resolveModelRefFromString({
        raw: trimmed,
        defaultProvider: params.defaultProvider,
        aliasIndex,
    });
    if (!resolved) {
        return { error: `invalid model: ${trimmed}` };
    }
    const status = getModelRefStatus({
        cfg: params.cfg,
        catalog: params.catalog,
        ref: resolved.ref,
        defaultProvider: params.defaultProvider,
        defaultModel: params.defaultModel,
    });
    if (!status.allowed) {
        return { error: `model not allowed: ${status.key}` };
    }
    return { ref: resolved.ref, key: status.key };
}
export function resolveThinkingDefault(params) {
    const _normalizedProvider = normalizeProviderId(params.provider);
    const _modelLower = params.model.toLowerCase();
    const configuredModels = params.cfg.agents?.defaults?.models;
    const canonicalKey = modelKey(params.provider, params.model);
    const legacyKey = legacyModelKey(params.provider, params.model);
    const perModelThinking = configuredModels?.[canonicalKey]?.params?.thinking ??
        (legacyKey ? configuredModels?.[legacyKey]?.params?.thinking : undefined);
    if (perModelThinking === "off" ||
        perModelThinking === "minimal" ||
        perModelThinking === "low" ||
        perModelThinking === "medium" ||
        perModelThinking === "high" ||
        perModelThinking === "xhigh" ||
        perModelThinking === "adaptive") {
        return perModelThinking;
    }
    const configured = params.cfg.agents?.defaults?.thinkingDefault;
    if (configured) {
        return configured;
    }
    return resolveThinkingDefaultForModel({
        provider: params.provider,
        model: params.model,
        catalog: params.catalog,
    });
}
/** Default reasoning level when session/directive do not set it: "on" if model supports reasoning, else "off". */
export function resolveReasoningDefault(params) {
    const key = modelKey(params.provider, params.model);
    const candidate = params.catalog?.find((entry) => (entry.provider === params.provider && entry.id === params.model) ||
        (entry.provider === key && entry.id === params.model));
    return candidate?.reasoning === true ? "on" : "off";
}
/**
 * Resolve the model configured for Gmail hook processing.
 * Returns null if hooks.gmail.model is not set.
 */
export function resolveHooksGmailModel(params) {
    const hooksModel = params.cfg.hooks?.gmail?.model;
    if (!hooksModel?.trim()) {
        return null;
    }
    const aliasIndex = buildModelAliasIndex({
        cfg: params.cfg,
        defaultProvider: params.defaultProvider,
    });
    const resolved = resolveModelRefFromString({
        raw: hooksModel,
        defaultProvider: params.defaultProvider,
        aliasIndex,
    });
    return resolved?.ref ?? null;
}
/**
 * Normalize a model selection value (string or `{primary?: string}`) to a
 * plain trimmed string.  Returns `undefined` when the input is empty/missing.
 * Shared by sessions-spawn and cron isolated-agent model resolution.
 */
export function normalizeModelSelection(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed || undefined;
    }
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const primary = value.primary;
    if (typeof primary === "string" && primary.trim()) {
        return primary.trim();
    }
    return undefined;
}
