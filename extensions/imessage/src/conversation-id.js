import { matchIMessageAcpConversation, normalizeIMessageAcpConversationId, resolveIMessageConversationIdFromTarget, } from "./conversation-id-core.js";
import { normalizeIMessageHandle } from "./targets.js";
export { matchIMessageAcpConversation, normalizeIMessageAcpConversationId, resolveIMessageConversationIdFromTarget, };
export function resolveIMessageInboundConversationId(params) {
    if (params.isGroup) {
        return params.chatId != null && Number.isFinite(params.chatId)
            ? String(params.chatId)
            : undefined;
    }
    const sender = normalizeIMessageHandle(params.sender);
    return sender || undefined;
}
