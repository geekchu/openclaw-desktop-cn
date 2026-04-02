import { streamSimple } from "@mariozechner/pi-ai";
import { resolveProviderAttributionHeaders } from "../provider-attribution.js";
import { log } from "./logger.js";
import { streamWithPayloadPatch } from "./stream-payload-utils.js";
const OPENAI_RESPONSES_APIS = new Set(["openai-responses"]);
const OPENAI_RESPONSES_PROVIDERS = new Set(["openai", "azure-openai", "azure-openai-responses"]);
function isDirectOpenAIBaseUrl(baseUrl) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
        return false;
    }
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        return (host === "api.openai.com" || host === "chatgpt.com" || host.endsWith(".openai.azure.com"));
    }
    catch {
        const normalized = baseUrl.toLowerCase();
        return (normalized.includes("api.openai.com") ||
            normalized.includes("chatgpt.com") ||
            normalized.includes(".openai.azure.com"));
    }
}
function isOpenAIPublicApiBaseUrl(baseUrl) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
        return false;
    }
    try {
        return new URL(baseUrl).hostname.toLowerCase() === "api.openai.com";
    }
    catch {
        return baseUrl.toLowerCase().includes("api.openai.com");
    }
}
function isOpenAICodexBaseUrl(baseUrl) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
        return false;
    }
    try {
        return new URL(baseUrl).hostname.toLowerCase() === "chatgpt.com";
    }
    catch {
        return baseUrl.toLowerCase().includes("chatgpt.com");
    }
}
function shouldApplyOpenAIAttributionHeaders(model) {
    if (model.provider === "openai" &&
        (model.api === "openai-completions" || model.api === "openai-responses") &&
        isOpenAIPublicApiBaseUrl(model.baseUrl)) {
        return "openai";
    }
    if (model.provider === "openai-codex" &&
        (model.api === "openai-codex-responses" || model.api === "openai-responses") &&
        isOpenAICodexBaseUrl(model.baseUrl)) {
        return "openai-codex";
    }
    return undefined;
}
function shouldForceResponsesStore(model) {
    if (model.compat?.supportsStore === false) {
        return false;
    }
    if (typeof model.api !== "string" || typeof model.provider !== "string") {
        return false;
    }
    if (!OPENAI_RESPONSES_APIS.has(model.api)) {
        return false;
    }
    if (!OPENAI_RESPONSES_PROVIDERS.has(model.provider)) {
        return false;
    }
    return isDirectOpenAIBaseUrl(model.baseUrl);
}
function parsePositiveInteger(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}
function resolveOpenAIResponsesCompactThreshold(model) {
    const contextWindow = parsePositiveInteger(model.contextWindow);
    if (contextWindow) {
        return Math.max(1_000, Math.floor(contextWindow * 0.7));
    }
    return 80_000;
}
function shouldEnableOpenAIResponsesServerCompaction(model, extraParams) {
    const configured = extraParams?.responsesServerCompaction;
    if (configured === false) {
        return false;
    }
    if (!shouldForceResponsesStore(model)) {
        return false;
    }
    if (configured === true) {
        return true;
    }
    return model.provider === "openai";
}
function shouldStripResponsesStore(model, forceStore) {
    if (forceStore) {
        return false;
    }
    if (typeof model.api !== "string") {
        return false;
    }
    return OPENAI_RESPONSES_APIS.has(model.api) && model.compat?.supportsStore === false;
}
function shouldStripResponsesPromptCache(model) {
    if (typeof model.api !== "string" || !OPENAI_RESPONSES_APIS.has(model.api)) {
        return false;
    }
    // Missing baseUrl means pi-ai will use the default OpenAI endpoint, so keep
    // prompt cache fields for that direct path.
    if (typeof model.baseUrl !== "string" || !model.baseUrl.trim()) {
        return false;
    }
    return !isDirectOpenAIBaseUrl(model.baseUrl);
}
function applyOpenAIResponsesPayloadOverrides(params) {
    if (params.forceStore) {
        params.payloadObj.store = true;
    }
    if (params.stripStore) {
        delete params.payloadObj.store;
    }
    if (params.stripPromptCache) {
        delete params.payloadObj.prompt_cache_key;
        delete params.payloadObj.prompt_cache_retention;
    }
    if (params.useServerCompaction && params.payloadObj.context_management === undefined) {
        params.payloadObj.context_management = [
            {
                type: "compaction",
                compact_threshold: params.compactThreshold,
            },
        ];
    }
}
function normalizeOpenAIServiceTier(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "auto" ||
        normalized === "default" ||
        normalized === "flex" ||
        normalized === "priority") {
        return normalized;
    }
    return undefined;
}
export function resolveOpenAIServiceTier(extraParams) {
    const raw = extraParams?.serviceTier ?? extraParams?.service_tier;
    const normalized = normalizeOpenAIServiceTier(raw);
    if (raw !== undefined && normalized === undefined) {
        const rawSummary = typeof raw === "string" ? raw : typeof raw;
        log.warn(`ignoring invalid OpenAI service tier param: ${rawSummary}`);
    }
    return normalized;
}
function normalizeOpenAIFastMode(value) {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "on" ||
        normalized === "true" ||
        normalized === "yes" ||
        normalized === "1" ||
        normalized === "fast") {
        return true;
    }
    if (normalized === "off" ||
        normalized === "false" ||
        normalized === "no" ||
        normalized === "0" ||
        normalized === "normal") {
        return false;
    }
    return undefined;
}
export function resolveOpenAIFastMode(extraParams) {
    const raw = extraParams?.fastMode ?? extraParams?.fast_mode;
    const normalized = normalizeOpenAIFastMode(raw);
    if (raw !== undefined && normalized === undefined) {
        const rawSummary = typeof raw === "string" ? raw : typeof raw;
        log.warn(`ignoring invalid OpenAI fast mode param: ${rawSummary}`);
    }
    return normalized;
}
function resolveFastModeReasoningEffort(modelId) {
    if (typeof modelId !== "string") {
        return "low";
    }
    const normalized = modelId.trim().toLowerCase();
    // Keep fast mode broadly compatible across GPT-5 family variants by using
    // the lowest shared non-disabled effort that current transports accept.
    if (normalized.startsWith("gpt-5")) {
        return "low";
    }
    return "low";
}
function applyOpenAIFastModePayloadOverrides(params) {
    if (params.payloadObj.reasoning === undefined) {
        params.payloadObj.reasoning = {
            effort: resolveFastModeReasoningEffort(params.model.id),
        };
    }
    const existingText = params.payloadObj.text;
    if (existingText === undefined) {
        params.payloadObj.text = { verbosity: "low" };
    }
    else if (existingText && typeof existingText === "object" && !Array.isArray(existingText)) {
        const textObj = existingText;
        if (textObj.verbosity === undefined) {
            textObj.verbosity = "low";
        }
    }
    if (params.model.provider === "openai" &&
        params.payloadObj.service_tier === undefined &&
        isOpenAIPublicApiBaseUrl(params.model.baseUrl)) {
        params.payloadObj.service_tier = "priority";
    }
}
export function createOpenAIResponsesContextManagementWrapper(baseStreamFn, extraParams) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
        const forceStore = shouldForceResponsesStore(model);
        const useServerCompaction = shouldEnableOpenAIResponsesServerCompaction(model, extraParams);
        const stripStore = shouldStripResponsesStore(model, forceStore);
        const stripPromptCache = shouldStripResponsesPromptCache(model);
        if (!forceStore && !useServerCompaction && !stripStore && !stripPromptCache) {
            return underlying(model, context, options);
        }
        const compactThreshold = parsePositiveInteger(extraParams?.responsesCompactThreshold) ??
            resolveOpenAIResponsesCompactThreshold(model);
        const originalOnPayload = options?.onPayload;
        return underlying(model, context, {
            ...options,
            onPayload: (payload) => {
                if (payload && typeof payload === "object") {
                    applyOpenAIResponsesPayloadOverrides({
                        payloadObj: payload,
                        forceStore,
                        stripStore,
                        stripPromptCache,
                        useServerCompaction,
                        compactThreshold,
                    });
                }
                return originalOnPayload?.(payload, model);
            },
        });
    };
}
export function createOpenAIFastModeWrapper(baseStreamFn) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
        if ((model.api !== "openai-responses" && model.api !== "openai-codex-responses") ||
            (model.provider !== "openai" && model.provider !== "openai-codex")) {
            return underlying(model, context, options);
        }
        const originalOnPayload = options?.onPayload;
        return underlying(model, context, {
            ...options,
            onPayload: (payload) => {
                if (payload && typeof payload === "object") {
                    applyOpenAIFastModePayloadOverrides({
                        payloadObj: payload,
                        model,
                    });
                }
                return originalOnPayload?.(payload, model);
            },
        });
    };
}
export function createOpenAIServiceTierWrapper(baseStreamFn, serviceTier) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
        if (model.api !== "openai-responses" ||
            model.provider !== "openai" ||
            !isOpenAIPublicApiBaseUrl(model.baseUrl)) {
            return underlying(model, context, options);
        }
        return streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
            if (payloadObj.service_tier === undefined) {
                payloadObj.service_tier = serviceTier;
            }
        });
    };
}
export function createCodexDefaultTransportWrapper(baseStreamFn) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => underlying(model, context, {
        ...options,
        transport: options?.transport ?? "auto",
    });
}
export function createOpenAIDefaultTransportWrapper(baseStreamFn) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
        const typedOptions = options;
        const mergedOptions = {
            ...options,
            transport: options?.transport ?? "auto",
            openaiWsWarmup: typedOptions?.openaiWsWarmup ?? false,
        };
        return underlying(model, context, mergedOptions);
    };
}
export function createOpenAIAttributionHeadersWrapper(baseStreamFn) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
        const attributionProvider = shouldApplyOpenAIAttributionHeaders(model);
        if (!attributionProvider) {
            return underlying(model, context, options);
        }
        return underlying(model, context, {
            ...options,
            headers: {
                ...options?.headers,
                ...resolveProviderAttributionHeaders(attributionProvider),
            },
        });
    };
}
