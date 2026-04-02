import { resolveSendableOutboundReplyParts } from "openclaw/plugin-sdk/reply-payload";
import { parseReplyDirectives } from "../../auto-reply/reply/reply-directives.js";
import { formatBtwTextForExternalDelivery, isRenderablePayload, shouldSuppressReasoningPayload, } from "../../auto-reply/reply/reply-payloads.js";
import { hasInteractiveReplyBlocks, hasReplyChannelData, hasReplyPayloadContent, } from "../../interactive/payload.js";
function mergeMediaUrls(...lists) {
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
        if (!list) {
            continue;
        }
        for (const entry of list) {
            const trimmed = entry?.trim();
            if (!trimmed) {
                continue;
            }
            if (seen.has(trimmed)) {
                continue;
            }
            seen.add(trimmed);
            merged.push(trimmed);
        }
    }
    return merged;
}
export function normalizeReplyPayloadsForDelivery(payloads) {
    const normalized = [];
    for (const payload of payloads) {
        if (shouldSuppressReasoningPayload(payload)) {
            continue;
        }
        const parsed = parseReplyDirectives(payload.text ?? "");
        const explicitMediaUrls = payload.mediaUrls ?? parsed.mediaUrls;
        const explicitMediaUrl = payload.mediaUrl ?? parsed.mediaUrl;
        const mergedMedia = mergeMediaUrls(explicitMediaUrls, explicitMediaUrl ? [explicitMediaUrl] : undefined);
        const hasMultipleMedia = (explicitMediaUrls?.length ?? 0) > 1;
        const resolvedMediaUrl = hasMultipleMedia ? undefined : explicitMediaUrl;
        const next = {
            ...payload,
            text: formatBtwTextForExternalDelivery({
                ...payload,
                text: parsed.text ?? "",
            }) ?? "",
            mediaUrls: mergedMedia.length ? mergedMedia : undefined,
            mediaUrl: resolvedMediaUrl,
            replyToId: payload.replyToId ?? parsed.replyToId,
            replyToTag: payload.replyToTag || parsed.replyToTag,
            replyToCurrent: payload.replyToCurrent || parsed.replyToCurrent,
            audioAsVoice: Boolean(payload.audioAsVoice || parsed.audioAsVoice),
        };
        if (parsed.isSilent && mergedMedia.length === 0) {
            continue;
        }
        if (!isRenderablePayload(next)) {
            continue;
        }
        normalized.push(next);
    }
    return normalized;
}
export function normalizeOutboundPayloads(payloads) {
    const normalizedPayloads = [];
    for (const payload of normalizeReplyPayloadsForDelivery(payloads)) {
        const parts = resolveSendableOutboundReplyParts(payload);
        const interactive = payload.interactive;
        const channelData = payload.channelData;
        const hasChannelData = hasReplyChannelData(channelData);
        const hasInteractive = hasInteractiveReplyBlocks(interactive);
        const text = parts.text;
        if (!hasReplyPayloadContent({ ...payload, text, mediaUrls: parts.mediaUrls }, { hasChannelData })) {
            continue;
        }
        normalizedPayloads.push({
            text,
            mediaUrls: parts.mediaUrls,
            audioAsVoice: payload.audioAsVoice === true ? true : undefined,
            ...(hasInteractive ? { interactive } : {}),
            ...(hasChannelData ? { channelData } : {}),
        });
    }
    return normalizedPayloads;
}
export function normalizeOutboundPayloadsForJson(payloads) {
    const normalized = [];
    for (const payload of normalizeReplyPayloadsForDelivery(payloads)) {
        const parts = resolveSendableOutboundReplyParts(payload);
        normalized.push({
            text: parts.text,
            mediaUrl: payload.mediaUrl ?? null,
            mediaUrls: parts.mediaUrls.length ? parts.mediaUrls : undefined,
            audioAsVoice: payload.audioAsVoice === true ? true : undefined,
            interactive: payload.interactive,
            channelData: payload.channelData,
        });
    }
    return normalized;
}
export function formatOutboundPayloadLog(payload) {
    const lines = [];
    if (payload.text) {
        lines.push(payload.text.trimEnd());
    }
    for (const url of payload.mediaUrls) {
        lines.push(`MEDIA:${url}`);
    }
    return lines.join("\n");
}
