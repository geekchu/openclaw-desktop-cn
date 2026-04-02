import { resolveBedrockConfigApiKey } from "../plugin-sdk/amazon-bedrock.js";
import { resolveAnthropicVertexConfigApiKey } from "../plugin-sdk/anthropic-vertex.js";
import { normalizeGoogleProviderConfig } from "../plugin-sdk/google.js";
import { applyModelStudioNativeStreamingUsageCompat } from "../plugin-sdk/modelstudio.js";
import { applyMoonshotNativeStreamingUsageCompat } from "../plugin-sdk/moonshot.js";
const PROVIDER_CONFIG_API_KEY_RESOLVERS = {
    "amazon-bedrock": resolveBedrockConfigApiKey,
    "anthropic-vertex": resolveAnthropicVertexConfigApiKey,
};
function shouldNormalizeGoogleProviderConfigLocally(providerKey) {
    return (providerKey === "google" ||
        providerKey === "google-antigravity" ||
        providerKey === "google-vertex");
}
export function applyNativeStreamingUsageCompat(providers) {
    let changed = false;
    const nextProviders = {};
    for (const [providerKey, provider] of Object.entries(providers)) {
        const nextProvider = providerKey === "modelstudio"
            ? applyModelStudioNativeStreamingUsageCompat(provider)
            : providerKey === "moonshot"
                ? applyMoonshotNativeStreamingUsageCompat(provider)
                : provider;
        nextProviders[providerKey] = nextProvider;
        changed ||= nextProvider !== provider;
    }
    return changed ? nextProviders : providers;
}
export function normalizeProviderSpecificConfig(providerKey, provider) {
    if (shouldNormalizeGoogleProviderConfigLocally(providerKey)) {
        return normalizeGoogleProviderConfig(providerKey, provider);
    }
    return provider;
}
export function resolveProviderConfigApiKeyResolver(providerKey) {
    const fallback = PROVIDER_CONFIG_API_KEY_RESOLVERS[providerKey];
    return fallback;
}
