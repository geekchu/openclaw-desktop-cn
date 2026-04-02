import { normalizeAccountId } from "openclaw/plugin-sdk/account-resolution";
import { resolveToolsBySender, } from "openclaw/plugin-sdk/channel-policy";
import { normalizeHyphenSlug } from "openclaw/plugin-sdk/core";
import { mergeSlackAccountConfig, resolveDefaultSlackAccountId } from "./accounts.js";
function resolveSlackChannelPolicyEntry(params) {
    const accountId = normalizeAccountId(params.accountId ?? resolveDefaultSlackAccountId(params.cfg));
    const channels = mergeSlackAccountConfig(params.cfg, accountId).channels;
    const channelMap = channels ?? {};
    if (Object.keys(channelMap).length === 0) {
        return undefined;
    }
    const channelId = params.groupId?.trim();
    const groupChannel = params.groupChannel;
    const channelName = groupChannel?.replace(/^#/, "");
    const normalizedName = normalizeHyphenSlug(channelName);
    const candidates = [
        channelId ?? "",
        channelName ? `#${channelName}` : "",
        channelName ?? "",
        normalizedName,
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (candidate && channelMap[candidate]) {
            return channelMap[candidate];
        }
    }
    return channelMap["*"];
}
function resolveSenderToolsEntry(entry, params) {
    if (!entry) {
        return undefined;
    }
    const senderPolicy = resolveToolsBySender({
        toolsBySender: entry.toolsBySender,
        senderId: params.senderId,
        senderName: params.senderName,
        senderUsername: params.senderUsername,
        senderE164: params.senderE164,
    });
    return senderPolicy ?? entry.tools;
}
export function resolveSlackGroupRequireMention(params) {
    const resolved = resolveSlackChannelPolicyEntry(params);
    if (typeof resolved?.requireMention === "boolean") {
        return resolved.requireMention;
    }
    return true;
}
export function resolveSlackGroupToolPolicy(params) {
    return resolveSenderToolsEntry(resolveSlackChannelPolicyEntry(params), params);
}
