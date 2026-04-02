import { resolveChannelGroupRequireMention, resolveChannelGroupToolsPolicy, } from "openclaw/plugin-sdk/channel-policy";
export function resolveIMessageGroupRequireMention(params) {
    return resolveChannelGroupRequireMention({
        cfg: params.cfg,
        channel: "imessage",
        groupId: params.groupId,
        accountId: params.accountId,
    });
}
export function resolveIMessageGroupToolPolicy(params) {
    return resolveChannelGroupToolsPolicy({
        cfg: params.cfg,
        channel: "imessage",
        groupId: params.groupId,
        accountId: params.accountId,
        senderId: params.senderId,
        senderName: params.senderName,
        senderUsername: params.senderUsername,
        senderE164: params.senderE164,
    });
}
