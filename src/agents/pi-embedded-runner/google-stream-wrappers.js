import { streamSimple } from "@mariozechner/pi-ai";
import { streamWithPayloadPatch } from "./stream-payload-utils.js";
function isGemini31Model(modelId) {
    const normalized = modelId.toLowerCase();
    return normalized.includes("gemini-3.1-pro") || normalized.includes("gemini-3.1-flash");
}
function mapThinkLevelToGoogleThinkingLevel(thinkingLevel) {
    switch (thinkingLevel) {
        case "minimal":
            return "MINIMAL";
        case "low":
            return "LOW";
        case "medium":
        case "adaptive":
            return "MEDIUM";
        case "high":
        case "xhigh":
            return "HIGH";
        default:
            return undefined;
    }
}
export function sanitizeGoogleThinkingPayload(params) {
    if (!params.payload || typeof params.payload !== "object") {
        return;
    }
    const payloadObj = params.payload;
    const config = payloadObj.config;
    if (!config || typeof config !== "object") {
        return;
    }
    const configObj = config;
    const thinkingConfig = configObj.thinkingConfig;
    if (!thinkingConfig || typeof thinkingConfig !== "object") {
        return;
    }
    const thinkingConfigObj = thinkingConfig;
    const thinkingBudget = thinkingConfigObj.thinkingBudget;
    if (typeof thinkingBudget !== "number" || thinkingBudget >= 0) {
        return;
    }
    // pi-ai can emit thinkingBudget=-1 for some Gemini 3.1 IDs; a negative budget
    // is invalid for Google-compatible backends and can lead to malformed handling.
    delete thinkingConfigObj.thinkingBudget;
    if (typeof params.modelId === "string" &&
        isGemini31Model(params.modelId) &&
        params.thinkingLevel &&
        params.thinkingLevel !== "off" &&
        thinkingConfigObj.thinkingLevel === undefined) {
        const mappedLevel = mapThinkLevelToGoogleThinkingLevel(params.thinkingLevel);
        if (mappedLevel) {
            thinkingConfigObj.thinkingLevel = mappedLevel;
        }
    }
}
export function createGoogleThinkingPayloadWrapper(baseStreamFn, thinkingLevel) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
        return streamWithPayloadPatch(underlying, model, context, options, (payload) => {
            if (model.api === "google-generative-ai") {
                sanitizeGoogleThinkingPayload({
                    payload,
                    modelId: model.id,
                    thinkingLevel,
                });
            }
        });
    };
}
