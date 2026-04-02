import { resolvePluginCapabilityProviders } from "../plugins/capability-provider-runtime.js";
import { normalizeMediaProviderId } from "./provider-id.js";
function mergeProviderIntoRegistry(registry, provider) {
    const normalizedKey = normalizeMediaProviderId(provider.id);
    const existing = registry.get(normalizedKey);
    const merged = existing
        ? {
            ...existing,
            ...provider,
            capabilities: provider.capabilities ?? existing.capabilities,
        }
        : provider;
    registry.set(normalizedKey, merged);
}
export { normalizeMediaProviderId } from "./provider-id.js";
export function buildMediaUnderstandingRegistry(overrides, cfg) {
    const registry = new Map();
    for (const provider of resolvePluginCapabilityProviders({
        key: "mediaUnderstandingProviders",
        cfg,
    })) {
        mergeProviderIntoRegistry(registry, provider);
    }
    if (overrides) {
        for (const [key, provider] of Object.entries(overrides)) {
            const normalizedKey = normalizeMediaProviderId(key);
            const existing = registry.get(normalizedKey);
            const merged = existing
                ? {
                    ...existing,
                    ...provider,
                    capabilities: provider.capabilities ?? existing.capabilities,
                }
                : provider;
            registry.set(normalizedKey, merged);
        }
    }
    return registry;
}
export function getMediaUnderstandingProvider(id, registry) {
    return registry.get(normalizeMediaProviderId(id));
}
