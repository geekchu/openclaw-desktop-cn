import { finalizeInboundContext } from "openclaw/plugin-sdk/reply-runtime";
import { buildDiscordInboundAccessContext } from "./inbound-context.js";
export function buildDiscordNativeCommandContext(params) {
    const conversationLabel = params.isDirectMessage
        ? (params.user.globalName ?? params.user.username)
        : params.channelId;
    const { groupSystemPrompt, ownerAllowFrom, untrustedContext } = buildDiscordInboundAccessContext({
        channelConfig: params.channelConfig,
        guildInfo: params.guildInfo,
        sender: params.sender,
        allowNameMatching: params.allowNameMatching,
        isGuild: params.isGuild,
        channelTopic: params.channelTopic,
    });
    return finalizeInboundContext({
        Body: params.prompt,
        BodyForAgent: params.prompt,
        RawBody: params.prompt,
        CommandBody: params.prompt,
        CommandArgs: params.commandArgs,
        From: params.isDirectMessage
            ? `discord:${params.user.id}`
            : params.isGroupDm
                ? `discord:group:${params.channelId}`
                : `discord:channel:${params.channelId}`,
        To: `slash:${params.user.id}`,
        SessionKey: params.sessionKey,
        CommandTargetSessionKey: params.commandTargetSessionKey,
        AccountId: params.accountId ?? undefined,
        ChatType: params.isDirectMessage ? "direct" : params.isGroupDm ? "group" : "channel",
        ConversationLabel: conversationLabel,
        GroupSubject: params.isGuild ? params.guildName : undefined,
        GroupSystemPrompt: groupSystemPrompt,
        UntrustedContext: untrustedContext,
        OwnerAllowFrom: ownerAllowFrom,
        SenderName: params.user.globalName ?? params.user.username,
        SenderId: params.user.id,
        SenderUsername: params.user.username,
        SenderTag: params.sender.tag,
        Provider: "discord",
        Surface: "discord",
        WasMentioned: true,
        MessageSid: params.interactionId,
        MessageThreadId: params.isThreadChannel ? params.channelId : undefined,
        Timestamp: params.timestampMs ?? Date.now(),
        CommandAuthorized: params.commandAuthorized,
        CommandSource: "native",
        // Native slash contexts use To=slash:<user> for interaction routing.
        // For follow-up delivery (for example subagent completion announces),
        // preserve the real Discord target separately.
        OriginatingChannel: "discord",
        OriginatingTo: params.isDirectMessage
            ? `user:${params.user.id}`
            : `channel:${params.channelId}`,
        ThreadParentId: params.isThreadChannel ? params.threadParentId : undefined,
    });
}
