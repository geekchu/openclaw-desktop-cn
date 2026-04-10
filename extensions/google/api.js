import { resolveProviderHttpRequestConfig, } from "openclaw/plugin-sdk/provider-http";
import { applyAgentDefaultModelPrimary, } from "openclaw/plugin-sdk/provider-onboard";
import { parseGoogleOauthApiKey } from "./oauth-token-shared.js";
import { DEFAULT_GOOGLE_API_BASE_URL, normalizeGoogleApiBaseUrl } from "./provider-policy.js";
export { normalizeAntigravityModelId, normalizeGoogleModelId } from "./model-id.js";
export { DEFAULT_GOOGLE_API_BASE_URL, isGoogleGenerativeAiApi, normalizeGoogleApiBaseUrl, normalizeGoogleGenerativeAiBaseUrl, normalizeGoogleProviderConfig, resolveGoogleGenerativeAiApiOrigin, resolveGoogleGenerativeAiTransport, shouldNormalizeGoogleGenerativeAiProviderConfig, shouldNormalizeGoogleProviderConfig, } from "./provider-policy.js";
export function parseGeminiAuth(apiKey) {
    const parsed = apiKey.startsWith("{") ? parseGoogleOauthApiKey(apiKey) : null;
    if (parsed?.token) {
        return {
            headers: {
                Authorization: `Bearer ${parsed.token}`,
                "Content-Type": "application/json",
            },
        };
    }
    return {
        headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
        },
    };
}
export function resolveGoogleGenerativeAiHttpRequestConfig(params) {
    return resolveProviderHttpRequestConfig({
        baseUrl: normalizeGoogleApiBaseUrl(params.baseUrl ?? DEFAULT_GOOGLE_API_BASE_URL),
        defaultBaseUrl: DEFAULT_GOOGLE_API_BASE_URL,
        allowPrivateNetwork: Boolean(params.baseUrl?.trim()),
        headers: params.headers,
        request: params.request,
        defaultHeaders: parseGeminiAuth(params.apiKey).headers,
        provider: "google",
        api: "google-generative-ai",
        capability: params.capability,
        transport: params.transport,
    });
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
