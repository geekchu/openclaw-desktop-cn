import { applyAgentDefaultModelPrimary, } from "openclaw/plugin-sdk/provider-onboard";
import { normalizeAntigravityModelId, normalizeGoogleModelId } from "./model-id.js";
export { normalizeAntigravityModelId, normalizeGoogleModelId };
const DEFAULT_GOOGLE_API_HOST = "generativelanguage.googleapis.com";
export const DEFAULT_GOOGLE_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
function trimTrailingSlashes(value) {
    return value.replace(/\/+$/, "");
}
export function normalizeGoogleApiBaseUrl(baseUrl) {
    const raw = trimTrailingSlashes(baseUrl?.trim() || DEFAULT_GOOGLE_API_BASE_URL);
    try {
        const url = new URL(raw);
        url.hash = "";
        url.search = "";
        if (url.hostname.toLowerCase() === DEFAULT_GOOGLE_API_HOST &&
            trimTrailingSlashes(url.pathname || "") === "") {
            url.pathname = "/v1beta";
        }
        return trimTrailingSlashes(url.toString());
    }
    catch {
        if (/^https:\/\/generativelanguage\.googleapis\.com\/?$/i.test(raw)) {
            return DEFAULT_GOOGLE_API_BASE_URL;
        }
        return raw;
    }
}
export function isGoogleGenerativeAiApi(api) {
    return api === "google-generative-ai";
}
export function normalizeGoogleGenerativeAiBaseUrl(baseUrl) {
    return baseUrl ? normalizeGoogleApiBaseUrl(baseUrl) : baseUrl;
}
export function resolveGoogleGenerativeAiTransport(params) {
    return {
        api: params.api,
        baseUrl: isGoogleGenerativeAiApi(params.api)
            ? normalizeGoogleGenerativeAiBaseUrl(params.baseUrl)
            : params.baseUrl,
    };
}
export function resolveGoogleGenerativeAiApiOrigin(baseUrl) {
    return normalizeGoogleApiBaseUrl(baseUrl).replace(/\/v1beta$/i, "");
}
export function shouldNormalizeGoogleGenerativeAiProviderConfig(providerKey, provider) {
    if (providerKey === "google" || providerKey === "google-vertex") {
        return true;
    }
    if (isGoogleGenerativeAiApi(provider.api)) {
        return true;
    }
    return provider.models?.some((model) => isGoogleGenerativeAiApi(model?.api)) ?? false;
}
export function shouldNormalizeGoogleProviderConfig(providerKey, provider) {
    return (providerKey === "google-antigravity" ||
        shouldNormalizeGoogleGenerativeAiProviderConfig(providerKey, provider));
}
function normalizeProviderModels(provider, normalizeId) {
    const models = provider.models;
    if (!Array.isArray(models) || models.length === 0) {
        return provider;
    }
    let mutated = false;
    const nextModels = models.map((model) => {
        const nextId = normalizeId(model.id);
        if (nextId === model.id) {
            return model;
        }
        mutated = true;
        return { ...model, id: nextId };
    });
    return mutated ? { ...provider, models: nextModels } : provider;
}
export function normalizeGoogleProviderConfig(providerKey, provider) {
    let nextProvider = provider;
    if (shouldNormalizeGoogleGenerativeAiProviderConfig(providerKey, nextProvider)) {
        const modelNormalized = normalizeProviderModels(nextProvider, normalizeGoogleModelId);
        const normalizedBaseUrl = normalizeGoogleGenerativeAiBaseUrl(modelNormalized.baseUrl);
        nextProvider =
            normalizedBaseUrl !== modelNormalized.baseUrl
                ? { ...modelNormalized, baseUrl: normalizedBaseUrl ?? modelNormalized.baseUrl }
                : modelNormalized;
    }
    if (providerKey === "google-antigravity") {
        nextProvider = normalizeProviderModels(nextProvider, normalizeAntigravityModelId);
    }
    return nextProvider;
}
export function parseGeminiAuth(apiKey) {
    if (apiKey.startsWith("{")) {
        try {
            const parsed = JSON.parse(apiKey);
            if (typeof parsed.token === "string" && parsed.token) {
                return {
                    headers: {
                        Authorization: `Bearer ${parsed.token}`,
                        "Content-Type": "application/json",
                    },
                };
            }
        }
        catch {
            // Fall back to API key mode.
        }
    }
    return {
        headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
        },
    };
}
export const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-3.1-pro-preview";
export function applyGoogleGeminiModelDefault(cfg) {
    const current = cfg.agents?.defaults?.model;
    const currentPrimary = typeof current === "string"
        ? current.trim() || undefined
        : current &&
            typeof current === "object" &&
            typeof current.primary === "string"
            ? (current.primary || "").trim() || undefined
            : undefined;
    if (currentPrimary === GOOGLE_GEMINI_DEFAULT_MODEL) {
        return { next: cfg, changed: false };
    }
    return {
        next: applyAgentDefaultModelPrimary(cfg, GOOGLE_GEMINI_DEFAULT_MODEL),
        changed: true,
    };
}
