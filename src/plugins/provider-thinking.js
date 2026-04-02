import { normalizeProviderId } from "../agents/provider-id.js";
import { getActivePluginRegistry } from "./runtime.js";
function matchesProviderId(provider, providerId) {
    const normalized = normalizeProviderId(providerId);
    if (!normalized) {
        return false;
    }
    if (normalizeProviderId(provider.id) === normalized) {
        return true;
    }
    return (provider.aliases ?? []).some((alias) => normalizeProviderId(alias) === normalized);
}
function resolveActiveThinkingProvider(providerId) {
    return getActivePluginRegistry()?.providers.find((entry) => {
        return matchesProviderId(entry.provider, providerId);
    })?.provider;
}
export function resolveProviderBinaryThinking(params) {
    return resolveActiveThinkingProvider(params.provider)?.isBinaryThinking?.(params.context);
}
export function resolveProviderXHighThinking(params) {
    return resolveActiveThinkingProvider(params.provider)?.supportsXHighThinking?.(params.context);
}
export function resolveProviderDefaultThinkingLevel(params) {
    return resolveActiveThinkingProvider(params.provider)?.resolveDefaultThinkingLevel?.(params.context);
}
