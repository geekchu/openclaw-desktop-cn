import { normalizeConversationText } from "../../acp/conversation-id.js";
import { resolveConversationBindingContext } from "../../channels/conversation-binding-context.js";
function resolveBindingChannel(ctx, commandChannel) {
    const raw = ctx.OriginatingChannel ?? commandChannel ?? ctx.Surface ?? ctx.Provider;
    return normalizeConversationText(raw).toLowerCase();
}
function resolveBindingAccountId(ctx) {
    const accountId = normalizeConversationText(ctx.AccountId);
    return accountId || "default";
}
function resolveBindingThreadId(threadId) {
    const normalized = threadId != null ? normalizeConversationText(String(threadId)) : undefined;
    return normalized || undefined;
}
export function resolveConversationBindingContextFromMessage(params) {
    return resolveConversationBindingContext({
        cfg: params.cfg,
        channel: resolveBindingChannel(params.ctx),
        accountId: resolveBindingAccountId(params.ctx),
        chatType: params.ctx.ChatType,
        threadId: resolveBindingThreadId(params.ctx.MessageThreadId),
        threadParentId: params.ctx.ThreadParentId,
        senderId: params.senderId ?? params.ctx.SenderId,
        sessionKey: params.sessionKey ?? params.ctx.SessionKey,
        parentSessionKey: params.parentSessionKey ?? params.ctx.ParentSessionKey,
        originatingTo: params.ctx.OriginatingTo,
        commandTo: params.commandTo,
        fallbackTo: params.ctx.To,
        from: params.ctx.From,
        nativeChannelId: params.ctx.NativeChannelId,
    });
}
export function resolveConversationBindingContextFromAcpCommand(params) {
    return resolveConversationBindingContextFromMessage({
        cfg: params.cfg,
        ctx: params.ctx,
        senderId: params.command.senderId,
        sessionKey: params.sessionKey,
        parentSessionKey: params.ctx.ParentSessionKey,
        commandTo: params.command.to,
    });
}
export function resolveConversationBindingChannelFromMessage(ctx, commandChannel) {
    return resolveBindingChannel(ctx, commandChannel);
}
export function resolveConversationBindingAccountIdFromMessage(ctx) {
    return resolveBindingAccountId(ctx);
}
export function resolveConversationBindingThreadIdFromMessage(ctx) {
    return resolveBindingThreadId(ctx.MessageThreadId);
}
