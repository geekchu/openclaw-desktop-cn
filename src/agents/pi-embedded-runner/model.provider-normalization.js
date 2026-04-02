import { normalizeModelCompat } from "../../plugins/provider-model-compat.js";
import { normalizeProviderId } from "../model-selection.js";
function isOpenAIApiBaseUrl(baseUrl) {
    const trimmed = baseUrl?.trim();
    if (!trimmed) {
        return false;
    }
    return /^https?:\/\/api\.openai\.com(?:\/v1)?\/?$/i.test(trimmed);
}
function isXaiApiBaseUrl(baseUrl) {
    const trimmed = baseUrl?.trim();
    if (!trimmed) {
        return false;
    }
    return /^https?:\/\/api\.x\.ai(?:\/v1)?\/?$/i.test(trimmed);
}
function normalizeOpenAITransport(params) {
    if (normalizeProviderId(params.provider) !== "openai") {
        return params.model;
    }
    const useResponsesTransport = params.model.api === "openai-completions" &&
        (!params.model.baseUrl || isOpenAIApiBaseUrl(params.model.baseUrl));
    if (!useResponsesTransport) {
        return params.model;
    }
    return {
        ...params.model,
        api: "openai-responses",
    };
}
function normalizeXaiTransport(params) {
    if (normalizeProviderId(params.provider) !== "xai") {
        return params.model;
    }
    const useResponsesTransport = params.model.api === "openai-completions" &&
        (!params.model.baseUrl || isXaiApiBaseUrl(params.model.baseUrl));
    if (!useResponsesTransport) {
        return params.model;
    }
    return {
        ...params.model,
        api: "openai-responses",
    };
}
export function applyBuiltInResolvedProviderTransportNormalization(params) {
    return normalizeXaiTransport({
        ...params,
        model: normalizeOpenAITransport(params),
    });
}
export function normalizeResolvedProviderModel(params) {
    return normalizeModelCompat(applyBuiltInResolvedProviderTransportNormalization(params));
}
