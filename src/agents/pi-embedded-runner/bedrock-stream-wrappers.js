import { streamSimple } from "@mariozechner/pi-ai";
export function createBedrockNoCacheWrapper(baseStreamFn) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => underlying(model, context, {
        ...options,
        cacheRetention: "none",
    });
}
export function isAnthropicBedrockModel(modelId) {
    const normalized = modelId.toLowerCase();
    return normalized.includes("anthropic.claude") || normalized.includes("anthropic/claude");
}
