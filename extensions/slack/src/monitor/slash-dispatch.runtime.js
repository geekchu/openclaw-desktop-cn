import { resolveMarkdownTableMode as resolveMarkdownTableModeImpl } from "openclaw/plugin-sdk/config-runtime";
import { recordInboundSessionMetaSafe as recordInboundSessionMetaSafeImpl, resolveConversationLabel as resolveConversationLabelImpl, } from "openclaw/plugin-sdk/conversation-runtime";
import { dispatchReplyWithDispatcher as dispatchReplyWithDispatcherImpl, finalizeInboundContext as finalizeInboundContextImpl, resolveChunkMode as resolveChunkModeImpl, } from "openclaw/plugin-sdk/reply-runtime";
import { resolveAgentRoute as resolveAgentRouteImpl } from "openclaw/plugin-sdk/routing";
import { deliverSlackSlashReplies as deliverSlackSlashRepliesImpl } from "./replies.js";
export function resolveChunkMode(...args) {
    return resolveChunkModeImpl(...args);
}
export function finalizeInboundContext(...args) {
    return finalizeInboundContextImpl(...args);
}
export function dispatchReplyWithDispatcher(...args) {
    return dispatchReplyWithDispatcherImpl(...args);
}
export function resolveConversationLabel(...args) {
    return resolveConversationLabelImpl(...args);
}
export function recordInboundSessionMetaSafe(...args) {
    return recordInboundSessionMetaSafeImpl(...args);
}
export function resolveMarkdownTableMode(...args) {
    return resolveMarkdownTableModeImpl(...args);
}
export function resolveAgentRoute(...args) {
    return resolveAgentRouteImpl(...args);
}
export function deliverSlackSlashReplies(...args) {
    return deliverSlackSlashRepliesImpl(...args);
}
