import { getChannelPlugin, normalizeChannelId } from "../../channels/plugins/index.js";
import { getActivePluginChannelRegistryVersion } from "../../plugins/runtime.js";
export function normalizeChannelTargetInput(raw) {
    return raw.trim();
}
const targetNormalizerCacheByChannelId = new Map();
function resolveTargetNormalizer(channelId) {
    const version = getActivePluginChannelRegistryVersion();
    const cached = targetNormalizerCacheByChannelId.get(channelId);
    if (cached?.version === version) {
        return cached.normalizer;
    }
    const plugin = getChannelPlugin(channelId);
    const normalizer = plugin?.messaging?.normalizeTarget;
    targetNormalizerCacheByChannelId.set(channelId, {
        version,
        normalizer,
    });
    return normalizer;
}
export function normalizeTargetForProvider(provider, raw) {
    if (!raw) {
        return undefined;
    }
    const fallback = raw.trim() || undefined;
    if (!fallback) {
        return undefined;
    }
    const providerId = normalizeChannelId(provider);
    const normalizer = providerId ? resolveTargetNormalizer(providerId) : undefined;
    const normalized = normalizer?.(raw) ?? fallback;
    return normalized || undefined;
}
export function buildTargetResolverSignature(channel) {
    const plugin = getChannelPlugin(channel);
    const resolver = plugin?.messaging?.targetResolver;
    const hint = resolver?.hint ?? "";
    const looksLike = resolver?.looksLikeId;
    const source = looksLike ? looksLike.toString() : "";
    return hashSignature(`${hint}|${source}`);
}
function hashSignature(value) {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
