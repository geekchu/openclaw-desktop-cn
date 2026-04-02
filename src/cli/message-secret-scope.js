import { normalizeAccountId } from "../routing/session-key.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
function resolveScopedChannelCandidate(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = normalizeMessageChannel(value);
    if (!normalized || !isDeliverableMessageChannel(normalized)) {
        return undefined;
    }
    return normalized;
}
function resolveChannelFromTargetValue(target) {
    if (typeof target !== "string") {
        return undefined;
    }
    const trimmed = target.trim();
    if (!trimmed) {
        return undefined;
    }
    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
        return undefined;
    }
    return resolveScopedChannelCandidate(trimmed.slice(0, separator));
}
function resolveChannelFromTargets(targets) {
    if (!Array.isArray(targets)) {
        return undefined;
    }
    const seen = new Set();
    for (const target of targets) {
        const channel = resolveChannelFromTargetValue(target);
        if (channel) {
            seen.add(channel);
        }
    }
    if (seen.size !== 1) {
        return undefined;
    }
    return [...seen][0];
}
function resolveScopedAccountId(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    return normalizeAccountId(trimmed);
}
export function resolveMessageSecretScope(params) {
    const channel = resolveScopedChannelCandidate(params.channel) ??
        resolveChannelFromTargetValue(params.target) ??
        resolveChannelFromTargets(params.targets) ??
        resolveScopedChannelCandidate(params.fallbackChannel);
    const accountId = resolveScopedAccountId(params.accountId) ??
        resolveScopedAccountId(params.fallbackAccountId ?? undefined);
    return {
        ...(channel ? { channel } : {}),
        ...(accountId ? { accountId } : {}),
    };
}
