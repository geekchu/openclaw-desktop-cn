import { MediaFetchError } from "openclaw/plugin-sdk/media-runtime";
export const APPROVE_CALLBACK_DATA_RE = /^\/approve(?:@[^\s]+)?\s+[A-Za-z0-9][A-Za-z0-9._:-]*\s+(allow-once|allow-always|deny)\b/i;
export function isMediaSizeLimitError(err) {
    const errMsg = String(err);
    return errMsg.includes("exceeds") && errMsg.includes("MB limit");
}
export function isRecoverableMediaGroupError(err) {
    return err instanceof MediaFetchError || isMediaSizeLimitError(err);
}
export function hasInboundMedia(msg) {
    return (Boolean(msg.media_group_id) ||
        (Array.isArray(msg.photo) && msg.photo.length > 0) ||
        Boolean(msg.video ?? msg.video_note ?? msg.document ?? msg.audio ?? msg.voice ?? msg.sticker));
}
export function hasReplyTargetMedia(msg) {
    const externalReply = msg.external_reply;
    const replyTarget = msg.reply_to_message ?? externalReply;
    return Boolean(replyTarget && hasInboundMedia(replyTarget));
}
export function resolveInboundMediaFileId(msg) {
    return (msg.sticker?.file_id ??
        msg.photo?.[msg.photo.length - 1]?.file_id ??
        msg.video?.file_id ??
        msg.video_note?.file_id ??
        msg.document?.file_id ??
        msg.audio?.file_id ??
        msg.voice?.file_id);
}
