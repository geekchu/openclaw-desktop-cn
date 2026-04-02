import { normalizeChatChannelId } from "../registry.js";
import { getChannelPlugin, normalizeChannelId } from "./registry.js";
function parseWithPlugin(rawChannel, rawTarget) {
    const channel = normalizeChatChannelId(rawChannel) ?? normalizeChannelId(rawChannel);
    if (!channel) {
        return null;
    }
    return getChannelPlugin(channel)?.messaging?.parseExplicitTarget?.({ raw: rawTarget }) ?? null;
}
export function parseExplicitTargetForChannel(channel, rawTarget) {
    return parseWithPlugin(channel, rawTarget);
}
