import { resolveProviderCapabilitiesWithPlugin as resolveProviderCapabilitiesWithPluginRuntime } from "../plugins/provider-runtime.js";
import { normalizeProviderId } from "./provider-id.js";
const DEFAULT_PROVIDER_CAPABILITIES = {
    anthropicToolSchemaMode: "native",
    anthropicToolChoiceMode: "native",
    openAiPayloadNormalizationMode: "default",
    providerFamily: "default",
    preserveAnthropicThinkingSignatures: true,
    openAiCompatTurnValidation: true,
    geminiThoughtSignatureSanitization: false,
    transcriptToolCallIdMode: "default",
    transcriptToolCallIdModelHints: [],
    geminiThoughtSignatureModelHints: [],
    dropThinkingBlockModelHints: [],
};
const CORE_PROVIDER_CAPABILITIES = {
    "anthropic-vertex": {
        providerFamily: "anthropic",
        dropThinkingBlockModelHints: ["claude"],
    },
    "amazon-bedrock": {
        providerFamily: "anthropic",
        dropThinkingBlockModelHints: ["claude"],
    },
};
const PLUGIN_CAPABILITIES_FALLBACKS = {
    anthropic: {
        providerFamily: "anthropic",
        dropThinkingBlockModelHints: ["claude"],
    },
    mistral: {
        transcriptToolCallIdMode: "strict9",
        transcriptToolCallIdModelHints: [
            "mistral",
            "mixtral",
            "codestral",
            "pixtral",
            "devstral",
            "ministral",
            "mistralai",
        ],
    },
    moonshot: {
        openAiPayloadNormalizationMode: "moonshot-thinking",
    },
    kimi: {
        openAiPayloadNormalizationMode: "moonshot-thinking",
    },
    opencode: {
        openAiCompatTurnValidation: false,
        geminiThoughtSignatureSanitization: true,
        geminiThoughtSignatureModelHints: ["gemini"],
    },
    "opencode-go": {
        openAiCompatTurnValidation: false,
        geminiThoughtSignatureSanitization: true,
        geminiThoughtSignatureModelHints: ["gemini"],
    },
    openai: {
        providerFamily: "openai",
    },
};
const defaultResolveProviderCapabilitiesWithPlugin = resolveProviderCapabilitiesWithPluginRuntime;
const providerCapabilityDeps = {
    resolveProviderCapabilitiesWithPlugin: defaultResolveProviderCapabilitiesWithPlugin,
};
export const __testing = {
    setResolveProviderCapabilitiesWithPluginForTest(resolveProviderCapabilitiesWithPlugin) {
        providerCapabilityDeps.resolveProviderCapabilitiesWithPlugin =
            resolveProviderCapabilitiesWithPlugin ?? defaultResolveProviderCapabilitiesWithPlugin;
    },
    resetDepsForTests() {
        providerCapabilityDeps.resolveProviderCapabilitiesWithPlugin =
            defaultResolveProviderCapabilitiesWithPlugin;
    },
};
export function resolveProviderCapabilities(provider, options) {
    const normalized = normalizeProviderId(provider ?? "");
    const pluginCapabilities = normalized
        ? providerCapabilityDeps.resolveProviderCapabilitiesWithPlugin({
            provider: normalized,
            config: options?.config,
            workspaceDir: options?.workspaceDir,
            env: options?.env,
        })
        : undefined;
    return {
        ...DEFAULT_PROVIDER_CAPABILITIES,
        ...CORE_PROVIDER_CAPABILITIES[normalized],
        ...PLUGIN_CAPABILITIES_FALLBACKS[normalized],
        ...pluginCapabilities,
    };
}
export function preservesAnthropicThinkingSignatures(provider, options) {
    return resolveProviderCapabilities(provider, options).preserveAnthropicThinkingSignatures;
}
export function requiresOpenAiCompatibleAnthropicToolPayload(provider, options) {
    const capabilities = resolveProviderCapabilities(provider, options);
    return (capabilities.anthropicToolSchemaMode !== "native" ||
        capabilities.anthropicToolChoiceMode !== "native");
}
export function usesOpenAiFunctionAnthropicToolSchema(provider, options) {
    return (resolveProviderCapabilities(provider, options).anthropicToolSchemaMode === "openai-functions");
}
export function usesOpenAiStringModeAnthropicToolChoice(provider, options) {
    return (resolveProviderCapabilities(provider, options).anthropicToolChoiceMode === "openai-string-modes");
}
export function supportsOpenAiCompatTurnValidation(provider, options) {
    return resolveProviderCapabilities(provider, options).openAiCompatTurnValidation;
}
export function usesMoonshotThinkingPayloadCompat(provider, options) {
    return (resolveProviderCapabilities(provider, options).openAiPayloadNormalizationMode ===
        "moonshot-thinking");
}
export function sanitizesGeminiThoughtSignatures(provider, options) {
    return resolveProviderCapabilities(provider, options).geminiThoughtSignatureSanitization;
}
function modelIncludesAnyHint(modelId, hints) {
    const normalized = (modelId ?? "").toLowerCase();
    return Boolean(normalized) && hints.some((hint) => normalized.includes(hint));
}
export function isOpenAiProviderFamily(provider, options) {
    return resolveProviderCapabilities(provider, options).providerFamily === "openai";
}
export function isAnthropicProviderFamily(provider, options) {
    return resolveProviderCapabilities(provider, options).providerFamily === "anthropic";
}
export function shouldDropThinkingBlocksForModel(params) {
    return modelIncludesAnyHint(params.modelId, resolveProviderCapabilities(params.provider, params).dropThinkingBlockModelHints);
}
export function shouldSanitizeGeminiThoughtSignaturesForModel(params) {
    const capabilities = resolveProviderCapabilities(params.provider, params);
    return (capabilities.geminiThoughtSignatureSanitization &&
        modelIncludesAnyHint(params.modelId, capabilities.geminiThoughtSignatureModelHints));
}
export function resolveTranscriptToolCallIdMode(provider, modelId, options) {
    const capabilities = resolveProviderCapabilities(provider, options);
    const mode = capabilities.transcriptToolCallIdMode;
    if (mode === "strict9") {
        return mode;
    }
    if (modelIncludesAnyHint(modelId, capabilities.transcriptToolCallIdModelHints)) {
        return "strict9";
    }
    return undefined;
}
