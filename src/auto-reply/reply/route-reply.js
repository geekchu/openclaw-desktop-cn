/**
 * Provider-agnostic reply router.
 *
 * Routes replies to the originating channel based on OriginatingChannel/OriginatingTo
 * instead of using the session's lastChannel. This ensures replies go back to the
 * provider where the message originated, even when the main session is shared
 * across multiple providers.
 */
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveEffectiveMessagesConfig } from "../../agents/identity.js";
import { getChannelPlugin, normalizeChannelId } from "../../channels/plugins/index.js";
import { buildOutboundSessionContext } from "../../infra/outbound/session-context.js";
import { hasReplyPayloadContent } from "../../interactive/payload.js";
import { INTERNAL_MESSAGE_CHANNEL, normalizeMessageChannel } from "../../utils/message-channel.js";
import { normalizeReplyPayload } from "./normalize-reply.js";
import { formatBtwTextForExternalDelivery, shouldSuppressReasoningPayload, } from "./reply-payloads.js";
let deliverRuntimePromise = null;
function loadDeliverRuntime() {
    deliverRuntimePromise ??= import("../../infra/outbound/deliver-runtime.js");
    return deliverRuntimePromise;
}
/**
 * Routes a reply payload to the specified channel.
 *
 * This function provides a unified interface for sending messages to any
 * supported provider. It's used by the followup queue to route replies
 * back to the originating channel when OriginatingChannel/OriginatingTo
 * are set.
 */
export async function routeReply(params) {
    const { payload, channel, to, accountId, threadId, cfg, abortSignal } = params;
    if (shouldSuppressReasoningPayload(payload)) {
        return { ok: true };
    }
    const normalizedChannel = normalizeMessageChannel(channel);
    const channelId = normalizeChannelId(channel) ?? null;
    const plugin = channelId ? getChannelPlugin(channelId) : undefined;
    const resolvedAgentId = params.sessionKey
        ? resolveSessionAgentId({
            sessionKey: params.sessionKey,
            config: cfg,
        })
        : undefined;
    // Debug: `pnpm test src/auto-reply/reply/route-reply.test.ts`
    const responsePrefix = params.sessionKey
        ? resolveEffectiveMessagesConfig(cfg, resolvedAgentId ?? resolveSessionAgentId({ config: cfg }), { channel: normalizedChannel, accountId }).responsePrefix
        : cfg.messages?.responsePrefix === "auto"
            ? undefined
            : cfg.messages?.responsePrefix;
    const normalized = normalizeReplyPayload(payload, {
        responsePrefix,
        enableSlackInteractiveReplies: plugin?.messaging?.enableInteractiveReplies?.({
            cfg,
            accountId,
        }),
    });
    if (!normalized) {
        return { ok: true };
    }
    const externalPayload = {
        ...normalized,
        text: formatBtwTextForExternalDelivery(normalized),
    };
    let text = externalPayload.text ?? "";
    let mediaUrls = (externalPayload.mediaUrls?.filter(Boolean) ?? []).length
        ? externalPayload.mediaUrls?.filter(Boolean)
        : externalPayload.mediaUrl
            ? [externalPayload.mediaUrl]
            : [];
    const replyToId = externalPayload.replyToId;
    const hasChannelData = plugin?.messaging?.hasStructuredReplyPayload?.({
        payload: externalPayload,
    });
    // Skip empty replies.
    if (!hasReplyPayloadContent({
        ...externalPayload,
        text,
        mediaUrls,
    }, {
        hasChannelData,
    })) {
        return { ok: true };
    }
    if (channel === INTERNAL_MESSAGE_CHANNEL) {
        return {
            ok: false,
            error: "Webchat routing not supported for queued replies",
        };
    }
    if (!channelId) {
        return { ok: false, error: `Unknown channel: ${String(channel)}` };
    }
    if (abortSignal?.aborted) {
        return { ok: false, error: "Reply routing aborted" };
    }
    const replyTransport = plugin?.threading?.resolveReplyTransport?.({
        cfg,
        accountId,
        threadId,
        replyToId,
    }) ?? null;
    const resolvedReplyToId = replyTransport?.replyToId ??
        replyToId ??
        ((channelId === "slack" || channelId === "mattermost") && threadId != null && threadId !== ""
            ? String(threadId)
            : undefined);
    const resolvedThreadId = replyTransport?.threadId ?? (channelId === "slack" ? null : (threadId ?? null));
    try {
        // Provider docking: this is an execution boundary (we're about to send).
        // Keep the module cheap to import by loading outbound plumbing lazily.
        const { deliverOutboundPayloads } = await loadDeliverRuntime();
        const outboundSession = buildOutboundSessionContext({
            cfg,
            agentId: resolvedAgentId,
            sessionKey: params.sessionKey,
        });
        const results = await deliverOutboundPayloads({
            cfg,
            channel: channelId,
            to,
            accountId: accountId ?? undefined,
            payloads: [externalPayload],
            replyToId: resolvedReplyToId ?? null,
            threadId: resolvedThreadId,
            session: outboundSession,
            abortSignal,
            mirror: params.mirror !== false && params.sessionKey
                ? {
                    sessionKey: params.sessionKey,
                    agentId: resolvedAgentId,
                    text,
                    mediaUrls,
                    ...(params.isGroup != null ? { isGroup: params.isGroup } : {}),
                    ...(params.groupId ? { groupId: params.groupId } : {}),
                }
                : undefined,
        });
        const last = results.at(-1);
        return { ok: true, messageId: last?.messageId };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            error: `Failed to route reply to ${channel}: ${message}`,
        };
    }
}
/**
 * Checks if a channel type is routable via routeReply.
 *
 * Some channels (webchat) require special handling and cannot be routed through
 * this generic interface.
 */
export function isRoutableChannel(channel) {
    if (!channel || channel === INTERNAL_MESSAGE_CHANNEL) {
        return false;
    }
    return normalizeChannelId(channel) !== null;
}
