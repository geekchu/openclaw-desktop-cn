import { CHAT_CHANNEL_ALIASES, CHAT_CHANNEL_ORDER, listChatChannelAliases, normalizeChatChannelId, } from "./ids.js";
import { buildChatChannelMetaById } from "./chat-meta-shared.js";
const CHAT_CHANNEL_META = buildChatChannelMetaById();
export { CHAT_CHANNEL_ALIASES, listChatChannelAliases, normalizeChatChannelId };
export function listChatChannels() {
    return CHAT_CHANNEL_ORDER.map((id) => CHAT_CHANNEL_META[id]);
}
export function getChatChannelMeta(id) {
    return CHAT_CHANNEL_META[id];
}
