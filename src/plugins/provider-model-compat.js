function extractModelCompat(modelOrCompat) {
    if (!modelOrCompat || typeof modelOrCompat !== "object") {
        return undefined;
    }
    if ("compat" in modelOrCompat) {
        const compat = modelOrCompat.compat;
        return compat && typeof compat === "object" ? compat : undefined;
    }
    return modelOrCompat;
}
export function applyModelCompatPatch(model, patch) {
    const nextCompat = { ...model.compat, ...patch };
    if (model.compat &&
        Object.entries(patch).every(([key, value]) => model.compat?.[key] === value)) {
        return model;
    }
    return {
        ...model,
        compat: nextCompat,
    };
}
export function hasToolSchemaProfile(modelOrCompat, profile) {
    return extractModelCompat(modelOrCompat)?.toolSchemaProfile === profile;
}
export function hasNativeWebSearchTool(modelOrCompat) {
    return extractModelCompat(modelOrCompat)?.nativeWebSearchTool === true;
}
export function resolveToolCallArgumentsEncoding(modelOrCompat) {
    return extractModelCompat(modelOrCompat)?.toolCallArgumentsEncoding;
}
export function resolveUnsupportedToolSchemaKeywords(modelOrCompat) {
    const keywords = extractModelCompat(modelOrCompat)?.unsupportedToolSchemaKeywords ?? [];
    return new Set(keywords
        .filter((keyword) => typeof keyword === "string")
        .map((keyword) => keyword.trim())
        .filter(Boolean));
}
function isOpenAiCompletionsModel(model) {
    return model.api === "openai-completions";
}
function isOpenAINativeEndpoint(baseUrl) {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        return host === "api.openai.com";
    }
    catch {
        return false;
    }
}
function isAnthropicMessagesModel(model) {
    return model.api === "anthropic-messages";
}
function normalizeAnthropicBaseUrl(baseUrl) {
    return baseUrl.replace(/\/v1\/?$/, "");
}
export function normalizeModelCompat(model) {
    const baseUrl = model.baseUrl ?? "";
    if (isAnthropicMessagesModel(model) && baseUrl) {
        const normalized = normalizeAnthropicBaseUrl(baseUrl);
        if (normalized !== baseUrl) {
            return { ...model, baseUrl: normalized };
        }
    }
    if (!isOpenAiCompletionsModel(model)) {
        return model;
    }
    const compat = model.compat ?? undefined;
    const needsForce = baseUrl ? !isOpenAINativeEndpoint(baseUrl) : false;
    if (!needsForce) {
        return model;
    }
    const forcedDeveloperRole = compat?.supportsDeveloperRole === true;
    const hasStreamingUsageOverride = compat?.supportsUsageInStreaming !== undefined;
    const targetStrictMode = compat?.supportsStrictMode ?? false;
    if (compat?.supportsDeveloperRole !== undefined &&
        hasStreamingUsageOverride &&
        compat?.supportsStrictMode !== undefined) {
        return model;
    }
    return {
        ...model,
        compat: compat
            ? {
                ...compat,
                supportsDeveloperRole: forcedDeveloperRole || false,
                ...(hasStreamingUsageOverride ? {} : { supportsUsageInStreaming: false }),
                supportsStrictMode: targetStrictMode,
            }
            : {
                supportsDeveloperRole: false,
                supportsUsageInStreaming: false,
                supportsStrictMode: false,
            },
    };
}
