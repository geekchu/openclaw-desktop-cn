import { resolveChannelGroupRequireMention, resolveChannelGroupToolsPolicy, } from "openclaw/plugin-sdk/channel-policy";
export function resolveBlueBubblesGroupRequireMention(params) {
    return resolveChannelGroupRequireMention({
        cfg: params.cfg,
        channel: "bluebubbles",
        groupId: params.groupId,
        accountId: params.accountId,
    });
}
export function resolveBlueBubblesGroupToolPolicy(params) {
    return resolveChannelGroupToolsPolicy({
        cfg: params.cfg,
        channel: "bluebubbles",
        groupId: params.groupId,
        accountId: params.accountId,
        senderId: params.senderId,
        senderName: params.senderName,
        senderUsername: params.senderUsername,
        senderE164: params.senderE164,
    });
}
