export function mapMattermostChannelTypeToChatType(channelType) {
    if (!channelType) {
        return "channel";
    }
    const normalized = channelType.trim().toUpperCase();
    if (normalized === "D") {
        return "direct";
    }
    if (normalized === "G" || normalized === "P") {
        return "group";
    }
    return "channel";
}
export function evaluateMattermostMentionGate(params) {
    const shouldRequireMention = params.kind !== "direct" &&
        params.resolveRequireMention({
            cfg: params.cfg,
            channel: "mattermost",
            accountId: params.accountId,
            groupId: params.channelId,
            requireMentionOverride: params.requireMentionOverride,
        });
    const shouldBypassMention = params.isControlCommand &&
        shouldRequireMention &&
        !params.wasMentioned &&
        params.commandAuthorized;
    const effectiveWasMentioned = params.wasMentioned || shouldBypassMention || params.oncharTriggered;
    if (params.oncharEnabled &&
        !params.oncharTriggered &&
        !params.wasMentioned &&
        !params.isControlCommand) {
        return {
            shouldRequireMention,
            shouldBypassMention,
            effectiveWasMentioned,
            dropReason: "onchar-not-triggered",
        };
    }
    if (params.kind !== "direct" &&
        shouldRequireMention &&
        params.canDetectMention &&
        !effectiveWasMentioned) {
        return {
            shouldRequireMention,
            shouldBypassMention,
            effectiveWasMentioned,
            dropReason: "missing-mention",
        };
    }
    return {
        shouldRequireMention,
        shouldBypassMention,
        effectiveWasMentioned,
        dropReason: null,
    };
}
