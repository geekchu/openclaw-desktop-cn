const LEGACY_SEND_DEP_KEYS = {
    whatsapp: "sendWhatsApp",
    telegram: "sendTelegram",
    discord: "sendDiscord",
    slack: "sendSlack",
    signal: "sendSignal",
    imessage: "sendIMessage",
    matrix: "sendMatrix",
    msteams: "sendMSTeams",
};
export function resolveOutboundSendDep(deps, channelId) {
    const dynamic = deps?.[channelId];
    if (dynamic !== undefined) {
        return dynamic;
    }
    const legacyKey = LEGACY_SEND_DEP_KEYS[channelId];
    const legacy = deps?.[legacyKey];
    return legacy;
}
