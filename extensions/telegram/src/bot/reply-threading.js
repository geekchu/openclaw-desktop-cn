export function createDeliveryProgress() {
    return {
        hasReplied: false,
        hasDelivered: false,
    };
}
export function resolveReplyToForSend(params) {
    return params.replyToId && (params.replyToMode === "all" || !params.progress.hasReplied)
        ? params.replyToId
        : undefined;
}
export function markReplyApplied(progress, replyToId) {
    if (replyToId && !progress.hasReplied) {
        progress.hasReplied = true;
    }
}
export function markDelivered(progress) {
    progress.hasDelivered = true;
}
export async function sendChunkedTelegramReplyText(params) {
    const applyDelivered = params.markDelivered ?? markDelivered;
    for (let i = 0; i < params.chunks.length; i += 1) {
        const chunk = params.chunks[i];
        if (!chunk) {
            continue;
        }
        const isFirstChunk = i === 0;
        const replyToMessageId = resolveReplyToForSend({
            replyToId: params.replyToId,
            replyToMode: params.replyToMode,
            progress: params.progress,
        });
        const shouldAttachQuote = Boolean(replyToMessageId) &&
            Boolean(params.replyQuoteText) &&
            (params.quoteOnlyOnFirstChunk !== true || isFirstChunk);
        await params.sendChunk({
            chunk,
            isFirstChunk,
            replyToMessageId,
            replyMarkup: isFirstChunk ? params.replyMarkup : undefined,
            replyQuoteText: shouldAttachQuote ? params.replyQuoteText : undefined,
        });
        markReplyApplied(params.progress, replyToMessageId);
        applyDelivered(params.progress);
    }
}
