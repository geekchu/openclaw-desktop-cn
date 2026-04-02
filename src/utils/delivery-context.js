import { normalizeAccountId } from "./account-id.js";
import { normalizeMessageChannel } from "./message-channel.js";
export function normalizeDeliveryContext(context) {
    if (!context) {
        return undefined;
    }
    const channel = typeof context.channel === "string"
        ? (normalizeMessageChannel(context.channel) ?? context.channel.trim())
        : undefined;
    const to = typeof context.to === "string" ? context.to.trim() : undefined;
    const accountId = normalizeAccountId(context.accountId);
    const threadId = typeof context.threadId === "number" && Number.isFinite(context.threadId)
        ? Math.trunc(context.threadId)
        : typeof context.threadId === "string"
            ? context.threadId.trim()
            : undefined;
    const normalizedThreadId = typeof threadId === "string" ? (threadId ? threadId : undefined) : threadId;
    if (!channel && !to && !accountId && normalizedThreadId == null) {
        return undefined;
    }
    const normalized = {
        channel: channel || undefined,
        to: to || undefined,
        accountId,
    };
    if (normalizedThreadId != null) {
        normalized.threadId = normalizedThreadId;
    }
    return normalized;
}
export function formatConversationTarget(params) {
    const channel = typeof params.channel === "string"
        ? (normalizeMessageChannel(params.channel) ?? params.channel.trim())
        : undefined;
    const conversationId = typeof params.conversationId === "number" && Number.isFinite(params.conversationId)
        ? String(Math.trunc(params.conversationId))
        : typeof params.conversationId === "string"
            ? params.conversationId.trim()
            : undefined;
    if (!channel || !conversationId) {
        return undefined;
    }
    if (channel === "matrix") {
        const parentConversationId = typeof params.parentConversationId === "number" &&
            Number.isFinite(params.parentConversationId)
            ? String(Math.trunc(params.parentConversationId))
            : typeof params.parentConversationId === "string"
                ? params.parentConversationId.trim()
                : undefined;
        const roomId = parentConversationId && parentConversationId !== conversationId
            ? parentConversationId
            : conversationId;
        return `room:${roomId}`;
    }
    return `channel:${conversationId}`;
}
export function resolveConversationDeliveryTarget(params) {
    const to = formatConversationTarget(params);
    const channel = typeof params.channel === "string"
        ? (normalizeMessageChannel(params.channel) ?? params.channel.trim())
        : undefined;
    const conversationId = typeof params.conversationId === "number" && Number.isFinite(params.conversationId)
        ? String(Math.trunc(params.conversationId))
        : typeof params.conversationId === "string"
            ? params.conversationId.trim()
            : undefined;
    const parentConversationId = typeof params.parentConversationId === "number" && Number.isFinite(params.parentConversationId)
        ? String(Math.trunc(params.parentConversationId))
        : typeof params.parentConversationId === "string"
            ? params.parentConversationId.trim()
            : undefined;
    if (channel === "matrix" &&
        to &&
        conversationId &&
        parentConversationId &&
        parentConversationId !== conversationId) {
        return { to, threadId: conversationId };
    }
    return { to };
}
export function normalizeSessionDeliveryFields(source) {
    if (!source) {
        return {
            deliveryContext: undefined,
            lastChannel: undefined,
            lastTo: undefined,
            lastAccountId: undefined,
            lastThreadId: undefined,
        };
    }
    const merged = mergeDeliveryContext(normalizeDeliveryContext({
        channel: source.lastChannel ?? source.channel,
        to: source.lastTo,
        accountId: source.lastAccountId,
        threadId: source.lastThreadId,
    }), normalizeDeliveryContext(source.deliveryContext));
    if (!merged) {
        return {
            deliveryContext: undefined,
            lastChannel: undefined,
            lastTo: undefined,
            lastAccountId: undefined,
            lastThreadId: undefined,
        };
    }
    return {
        deliveryContext: merged,
        lastChannel: merged.channel,
        lastTo: merged.to,
        lastAccountId: merged.accountId,
        lastThreadId: merged.threadId,
    };
}
export function deliveryContextFromSession(entry) {
    if (!entry) {
        return undefined;
    }
    const source = {
        channel: entry.channel ?? entry.origin?.provider,
        lastChannel: entry.lastChannel,
        lastTo: entry.lastTo,
        lastAccountId: entry.lastAccountId ?? entry.origin?.accountId,
        lastThreadId: entry.lastThreadId ?? entry.deliveryContext?.threadId ?? entry.origin?.threadId,
        origin: entry.origin,
        deliveryContext: entry.deliveryContext,
    };
    return normalizeSessionDeliveryFields(source).deliveryContext;
}
export function mergeDeliveryContext(primary, fallback) {
    const normalizedPrimary = normalizeDeliveryContext(primary);
    const normalizedFallback = normalizeDeliveryContext(fallback);
    if (!normalizedPrimary && !normalizedFallback) {
        return undefined;
    }
    const channelsConflict = normalizedPrimary?.channel &&
        normalizedFallback?.channel &&
        normalizedPrimary.channel !== normalizedFallback.channel;
    return normalizeDeliveryContext({
        channel: normalizedPrimary?.channel ?? normalizedFallback?.channel,
        // Keep route fields paired to their channel; avoid crossing fields between
        // unrelated channels during session context merges.
        to: channelsConflict
            ? normalizedPrimary?.to
            : (normalizedPrimary?.to ?? normalizedFallback?.to),
        accountId: channelsConflict
            ? normalizedPrimary?.accountId
            : (normalizedPrimary?.accountId ?? normalizedFallback?.accountId),
        threadId: channelsConflict
            ? normalizedPrimary?.threadId
            : (normalizedPrimary?.threadId ?? normalizedFallback?.threadId),
    });
}
export function deliveryContextKey(context) {
    const normalized = normalizeDeliveryContext(context);
    if (!normalized?.channel || !normalized?.to) {
        return undefined;
    }
    const threadId = normalized.threadId != null && normalized.threadId !== "" ? String(normalized.threadId) : "";
    return `${normalized.channel}|${normalized.to}|${normalized.accountId ?? ""}|${threadId}`;
}
