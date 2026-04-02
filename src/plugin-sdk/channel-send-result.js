export function attachChannelToResult(channel, result) {
    return {
        channel,
        ...result,
    };
}
export function attachChannelToResults(channel, results) {
    return results.map((result) => attachChannelToResult(channel, result));
}
export function createEmptyChannelResult(channel, result = {}) {
    return attachChannelToResult(channel, {
        messageId: "",
        ...result,
    });
}
export function createAttachedChannelResultAdapter(params) {
    return {
        sendText: params.sendText
            ? async (ctx) => attachChannelToResult(params.channel, await params.sendText(ctx))
            : undefined,
        sendMedia: params.sendMedia
            ? async (ctx) => attachChannelToResult(params.channel, await params.sendMedia(ctx))
            : undefined,
        sendPoll: params.sendPoll
            ? async (ctx) => attachChannelToResult(params.channel, await params.sendPoll(ctx))
            : undefined,
    };
}
export function createRawChannelSendResultAdapter(params) {
    return {
        sendText: params.sendText
            ? async (ctx) => buildChannelSendResult(params.channel, await params.sendText(ctx))
            : undefined,
        sendMedia: params.sendMedia
            ? async (ctx) => buildChannelSendResult(params.channel, await params.sendMedia(ctx))
            : undefined,
    };
}
/** Normalize raw channel send results into the shape shared outbound callers expect. */
export function buildChannelSendResult(channel, result) {
    return {
        channel,
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
    };
}
