const LEGACY_SOURCE_TO_CHANNEL = {
    sendMessageWhatsApp: "whatsapp",
    sendMessageTelegram: "telegram",
    sendMessageDiscord: "discord",
    sendMessageSlack: "slack",
    sendMessageSignal: "signal",
    sendMessageIMessage: "imessage",
};
const CHANNEL_TO_LEGACY_DEP_KEY = {
    whatsapp: "sendWhatsApp",
    telegram: "sendTelegram",
    discord: "sendDiscord",
    slack: "sendSlack",
    signal: "sendSignal",
    imessage: "sendIMessage",
};
/**
 * Pass CLI send sources through as-is — both CliOutboundSendSource and
 * OutboundSendDeps are now channel-ID-keyed records.
 */
export function createOutboundSendDepsFromCliSource(deps) {
    const outbound = { ...deps };
    for (const [legacySourceKey, channelId] of Object.entries(LEGACY_SOURCE_TO_CHANNEL)) {
        const sourceValue = deps[legacySourceKey];
        if (sourceValue !== undefined && outbound[channelId] === undefined) {
            outbound[channelId] = sourceValue;
        }
    }
    for (const [channelId, legacyDepKey] of Object.entries(CHANNEL_TO_LEGACY_DEP_KEY)) {
        const sourceValue = outbound[channelId];
        if (sourceValue !== undefined && outbound[legacyDepKey] === undefined) {
            outbound[legacyDepKey] = sourceValue;
        }
    }
    return outbound;
}
