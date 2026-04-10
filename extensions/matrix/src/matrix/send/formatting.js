import { getMatrixRuntime } from "../../runtime.js";
import { markdownToMatrixHtml, resolveMatrixMentionsInMarkdown, renderMarkdownToMatrixHtmlWithMentions, } from "../format.js";
import { MsgType, RelationType, } from "./types.js";
const getCore = () => getMatrixRuntime();
async function renderMatrixFormattedContent(params) {
    const markdown = params.markdown ?? "";
    if (params.includeMentions === false) {
        const html = markdownToMatrixHtml(markdown).trimEnd();
        return { html: html || undefined };
    }
    const { html, mentions } = await renderMarkdownToMatrixHtmlWithMentions({
        markdown,
        client: params.client,
    });
    return { html, mentions };
}
export function buildTextContent(body, relation, opts = {}) {
    const msgtype = opts.msgtype ?? MsgType.Text;
    return relation
        ? {
            msgtype,
            body,
            "m.relates_to": relation,
        }
        : {
            msgtype,
            body,
        };
}
export async function enrichMatrixFormattedContent(params) {
    const { html, mentions } = await renderMatrixFormattedContent({
        client: params.client,
        markdown: params.markdown,
        includeMentions: params.includeMentions,
    });
    if (mentions) {
        params.content["m.mentions"] = mentions;
    }
    else {
        delete params.content["m.mentions"];
    }
    if (!html) {
        delete params.content.format;
        delete params.content.formatted_body;
        return;
    }
    params.content.format = "org.matrix.custom.html";
    params.content.formatted_body = html;
}
export async function resolveMatrixMentionsForBody(params) {
    return await resolveMatrixMentionsInMarkdown({
        markdown: params.body ?? "",
        client: params.client,
    });
}
function normalizeMentionUserIds(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        : [];
}
export function extractMatrixMentions(content) {
    const rawMentions = content?.["m.mentions"];
    if (!rawMentions || typeof rawMentions !== "object") {
        return {};
    }
    const mentions = rawMentions;
    const normalized = {};
    const userIds = normalizeMentionUserIds(mentions.user_ids);
    if (userIds.length > 0) {
        normalized.user_ids = userIds;
    }
    if (mentions.room === true) {
        normalized.room = true;
    }
    return normalized;
}
export function diffMatrixMentions(current, previous) {
    const previousUserIds = new Set(previous.user_ids ?? []);
    const newUserIds = (current.user_ids ?? []).filter((userId) => !previousUserIds.has(userId));
    const delta = {};
    if (newUserIds.length > 0) {
        delta.user_ids = newUserIds;
    }
    if (current.room && !previous.room) {
        delta.room = true;
    }
    return delta;
}
export function buildReplyRelation(replyToId) {
    const trimmed = replyToId?.trim();
    if (!trimmed) {
        return undefined;
    }
    return { "m.in_reply_to": { event_id: trimmed } };
}
export function buildThreadRelation(threadId, replyToId) {
    const trimmed = threadId.trim();
    return {
        rel_type: RelationType.Thread,
        event_id: trimmed,
        is_falling_back: true,
        "m.in_reply_to": { event_id: replyToId?.trim() || trimmed },
    };
}
export function resolveMatrixMsgType(contentType, _fileName) {
    const kind = getCore().media.mediaKindFromMime(contentType ?? "");
    switch (kind) {
        case "image":
            return MsgType.Image;
        case "audio":
            return MsgType.Audio;
        case "video":
            return MsgType.Video;
        default:
            return MsgType.File;
    }
}
export function resolveMatrixVoiceDecision(opts) {
    if (!opts.wantsVoice) {
        return { useVoice: false };
    }
    if (isMatrixVoiceCompatibleAudio(opts)) {
        return { useVoice: true };
    }
    return { useVoice: false };
}
function isMatrixVoiceCompatibleAudio(opts) {
    // Matrix currently shares the core voice compatibility policy.
    // Keep this wrapper as the seam if Matrix policy diverges later.
    return getCore().media.isVoiceCompatibleAudio({
        contentType: opts.contentType,
        fileName: opts.fileName,
    });
}
