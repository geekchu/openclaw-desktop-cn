const CHANNEL_ID = "synology-chat";
export function buildSynologyChatInboundContext(params) {
    const { account, msg, sessionKey } = params;
    return params.finalizeInboundContext({
        Body: msg.body,
        RawBody: msg.body,
        CommandBody: msg.body,
        From: `synology-chat:${msg.from}`,
        To: `synology-chat:${msg.from}`,
        SessionKey: sessionKey,
        AccountId: account.accountId,
        OriginatingChannel: CHANNEL_ID,
        OriginatingTo: `synology-chat:${msg.from}`,
        ChatType: msg.chatType,
        SenderName: msg.senderName,
        SenderId: msg.from,
        Provider: CHANNEL_ID,
        Surface: CHANNEL_ID,
        ConversationLabel: msg.senderName || msg.from,
        Timestamp: Date.now(),
        CommandAuthorized: msg.commandAuthorized,
    });
}
