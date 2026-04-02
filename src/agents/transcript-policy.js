import { normalizeProviderId } from "./model-selection.js";
import { isGoogleModelApi } from "./pi-embedded-helpers/google.js";
import { isAnthropicProviderFamily, isOpenAiProviderFamily, preservesAnthropicThinkingSignatures, resolveTranscriptToolCallIdMode, shouldDropThinkingBlocksForModel, shouldSanitizeGeminiThoughtSignaturesForModel, supportsOpenAiCompatTurnValidation, } from "./provider-capabilities.js";
const OPENAI_MODEL_APIS = new Set([
    "openai",
    "openai-completions",
    "openai-responses",
    "openai-codex-responses",
]);
function isOpenAiApi(modelApi) {
    if (!modelApi) {
        return false;
    }
    return OPENAI_MODEL_APIS.has(modelApi);
}
function isOpenAiProvider(provider) {
    return isOpenAiProviderFamily(provider);
}
function isAnthropicApi(modelApi, provider) {
    if (modelApi === "anthropic-messages" || modelApi === "bedrock-converse-stream") {
        return true;
    }
    // MiniMax now uses openai-completions API, not anthropic-messages
    return isAnthropicProviderFamily(provider);
}
export function resolveTranscriptPolicy(params) {
    const provider = normalizeProviderId(params.provider ?? "");
    const modelId = params.modelId ?? "";
    const isGoogle = isGoogleModelApi(params.modelApi);
    const isAnthropic = isAnthropicApi(params.modelApi, provider);
    const isOpenAi = isOpenAiProvider(provider) || (!provider && isOpenAiApi(params.modelApi));
    const isStrictOpenAiCompatible = params.modelApi === "openai-completions" &&
        !isOpenAi &&
        supportsOpenAiCompatTurnValidation(provider);
    const providerToolCallIdMode = resolveTranscriptToolCallIdMode(provider, modelId);
    const isMistral = providerToolCallIdMode === "strict9";
    const shouldSanitizeGeminiThoughtSignaturesForProvider = shouldSanitizeGeminiThoughtSignaturesForModel({
        provider,
        modelId,
    });
    const requiresOpenAiCompatibleToolIdSanitization = params.modelApi === "openai-completions" ||
        (!isOpenAi &&
            (params.modelApi === "openai-responses" || params.modelApi === "openai-codex-responses"));
    // Anthropic Claude endpoints can reject replayed `thinking` blocks unless the
    // original signatures are preserved byte-for-byte. Drop them at send-time to
    // keep persisted sessions usable across follow-up turns.
    const dropThinkingBlocks = shouldDropThinkingBlocksForModel({ provider, modelId });
    const needsNonImageSanitize = isGoogle || isAnthropic || isMistral || shouldSanitizeGeminiThoughtSignaturesForProvider;
    const sanitizeToolCallIds = isGoogle || isMistral || isAnthropic || requiresOpenAiCompatibleToolIdSanitization;
    const toolCallIdMode = providerToolCallIdMode
        ? providerToolCallIdMode
        : isMistral
            ? "strict9"
            : sanitizeToolCallIds
                ? "strict"
                : undefined;
    // All providers need orphaned tool_result repair after history truncation.
    // OpenAI rejects function_call_output items whose call_id has no matching
    // function_call in the conversation, so the repair must run universally.
    const repairToolUseResultPairing = true;
    const sanitizeThoughtSignatures = shouldSanitizeGeminiThoughtSignaturesForProvider || isGoogle
        ? { allowBase64Only: true, includeCamelCase: true }
        : undefined;
    return {
        sanitizeMode: isOpenAi ? "images-only" : needsNonImageSanitize ? "full" : "images-only",
        sanitizeToolCallIds: (!isOpenAi && sanitizeToolCallIds) || requiresOpenAiCompatibleToolIdSanitization,
        toolCallIdMode,
        repairToolUseResultPairing,
        preserveSignatures: isAnthropic && preservesAnthropicThinkingSignatures(provider),
        sanitizeThoughtSignatures: isOpenAi ? undefined : sanitizeThoughtSignatures,
        sanitizeThinkingSignatures: false,
        dropThinkingBlocks,
        applyGoogleTurnOrdering: !isOpenAi && (isGoogle || isStrictOpenAiCompatible),
        validateGeminiTurns: !isOpenAi && (isGoogle || isStrictOpenAiCompatible),
        validateAnthropicTurns: !isOpenAi && (isAnthropic || isStrictOpenAiCompatible),
        allowSyntheticToolResults: !isOpenAi && (isGoogle || isAnthropic),
    };
}
