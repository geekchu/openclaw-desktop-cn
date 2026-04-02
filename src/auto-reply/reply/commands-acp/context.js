import { normalizeConversationText } from "../../../acp/conversation-id.js";
import { resolveConversationBindingAccountIdFromMessage, resolveConversationBindingChannelFromMessage, resolveConversationBindingContextFromAcpCommand, resolveConversationBindingThreadIdFromMessage, } from "../conversation-binding-input.js";
export function resolveAcpCommandChannel(params) {
    const resolved = resolveConversationBindingChannelFromMessage(params.ctx, params.command.channel);
    return normalizeConversationText(resolved).toLowerCase();
}
export function resolveAcpCommandAccountId(params) {
    return resolveConversationBindingAccountIdFromMessage(params.ctx);
}
export function resolveAcpCommandThreadId(params) {
    return resolveConversationBindingThreadIdFromMessage(params.ctx);
}
function resolveAcpCommandConversationRef(params) {
    const resolved = resolveConversationBindingContextFromAcpCommand(params);
    if (!resolved) {
        return null;
    }
    return {
        conversationId: resolved.conversationId,
        ...(resolved.parentConversationId && resolved.parentConversationId !== resolved.conversationId
            ? { parentConversationId: resolved.parentConversationId }
            : {}),
    };
}
export function resolveAcpCommandConversationId(params) {
    return resolveAcpCommandConversationRef(params)?.conversationId;
}
export function resolveAcpCommandParentConversationId(params) {
    return resolveAcpCommandConversationRef(params)?.parentConversationId;
}
export function resolveAcpCommandBindingContext(params) {
    const conversationRef = resolveAcpCommandConversationRef(params);
    if (!conversationRef) {
        return {
            channel: resolveAcpCommandChannel(params),
            accountId: resolveAcpCommandAccountId(params),
            threadId: resolveAcpCommandThreadId(params),
        };
    }
    return {
        channel: resolveAcpCommandChannel(params),
        accountId: resolveAcpCommandAccountId(params),
        threadId: resolveAcpCommandThreadId(params),
        conversationId: conversationRef.conversationId,
        ...(conversationRef.parentConversationId
            ? { parentConversationId: conversationRef.parentConversationId }
            : {}),
    };
}
