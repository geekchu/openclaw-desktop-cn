import { resolvePluginCapabilityProviders } from "../plugins/capability-provider-runtime.js";
function trimToUndefined(value) {
    const trimmed = value?.trim().toLowerCase();
    return trimmed ? trimmed : undefined;
}
export function normalizeSpeechProviderId(providerId) {
    return trimToUndefined(providerId);
}
function resolveSpeechProviderPluginEntries(cfg) {
    return resolvePluginCapabilityProviders({
        key: "speechProviders",
        cfg,
    });
}
function buildProviderMaps(cfg) {
    const canonical = new Map();
    const aliases = new Map();
    const register = (provider) => {
        const id = normalizeSpeechProviderId(provider.id);
        if (!id) {
            return;
        }
        canonical.set(id, provider);
        aliases.set(id, provider);
        for (const alias of provider.aliases ?? []) {
            const normalizedAlias = normalizeSpeechProviderId(alias);
            if (normalizedAlias) {
                aliases.set(normalizedAlias, provider);
            }
        }
    };
    for (const provider of resolveSpeechProviderPluginEntries(cfg)) {
        register(provider);
    }
    return { canonical, aliases };
}
export function listSpeechProviders(cfg) {
    return [...buildProviderMaps(cfg).canonical.values()];
}
export function getSpeechProvider(providerId, cfg) {
    const normalized = normalizeSpeechProviderId(providerId);
    if (!normalized) {
        return undefined;
    }
    return buildProviderMaps(cfg).aliases.get(normalized);
}
export function canonicalizeSpeechProviderId(providerId, cfg) {
    const normalized = normalizeSpeechProviderId(providerId);
    if (!normalized) {
        return undefined;
    }
    return getSpeechProvider(normalized, cfg)?.id ?? normalized;
}
