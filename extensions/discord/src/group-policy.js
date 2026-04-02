import { resolveToolsBySender, } from "openclaw/plugin-sdk/channel-policy";
import { normalizeAtHashSlug } from "openclaw/plugin-sdk/core";
function normalizeDiscordSlug(value) {
    return normalizeAtHashSlug(value);
}
function resolveDiscordGuildEntry(guilds, groupSpace) {
    if (!guilds || Object.keys(guilds).length === 0) {
        return null;
    }
    const space = groupSpace?.trim() ?? "";
    if (space && guilds[space]) {
        return guilds[space];
    }
    const normalized = normalizeDiscordSlug(space);
    if (normalized && guilds[normalized]) {
        return guilds[normalized];
    }
    if (normalized) {
        const match = Object.values(guilds).find((entry) => normalizeDiscordSlug(entry?.slug ?? undefined) === normalized);
        if (match) {
            return match;
        }
    }
    return guilds["*"] ?? null;
}
function resolveDiscordChannelEntry(channelEntries, params) {
    if (!channelEntries || Object.keys(channelEntries).length === 0) {
        return undefined;
    }
    const groupChannel = params.groupChannel;
    const channelSlug = normalizeDiscordSlug(groupChannel);
    return ((params.groupId ? channelEntries[params.groupId] : undefined) ??
        (channelSlug
            ? (channelEntries[channelSlug] ?? channelEntries[`#${channelSlug}`])
            : undefined) ??
        (groupChannel ? channelEntries[normalizeDiscordSlug(groupChannel)] : undefined));
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
function resolveDiscordPolicyContext(params) {
    const guildEntry = resolveDiscordGuildEntry(params.cfg.channels?.discord?.guilds, params.groupSpace);
    const channelEntries = guildEntry?.channels;
    const channelEntry = channelEntries && Object.keys(channelEntries).length > 0
        ? resolveDiscordChannelEntry(channelEntries, params)
        : undefined;
    return { guildEntry, channelEntry };
}
export function resolveDiscordGroupRequireMention(params) {
    const context = resolveDiscordPolicyContext(params);
    if (typeof context.channelEntry?.requireMention === "boolean") {
        return context.channelEntry.requireMention;
    }
    if (typeof context.guildEntry?.requireMention === "boolean") {
        return context.guildEntry.requireMention;
    }
    return true;
}
export function resolveDiscordGroupToolPolicy(params) {
    const context = resolveDiscordPolicyContext(params);
    const channelPolicy = resolveSenderToolsEntry(context.channelEntry, params);
    if (channelPolicy) {
        return channelPolicy;
    }
    return resolveSenderToolsEntry(context.guildEntry, params);
}
