import { resolveMarkdownTableMode } from "openclaw/plugin-sdk/config-runtime";
import { convertMarkdownTables } from "openclaw/plugin-sdk/text-runtime";
import { resolveFeishuRuntimeAccount } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { buildMentionedMessage, buildMentionedCardContent } from "./mention.js";
import { parsePostContent } from "./post.js";
import { assertFeishuMessageApiSuccess, toFeishuSendResult } from "./send-result.js";
import { resolveFeishuSendTarget } from "./send-target.js";
const WITHDRAWN_REPLY_ERROR_CODES = new Set([230011, 231003]);
const FEISHU_CARD_TEMPLATES = new Set([
    "blue",
    "green",
    "red",
    "orange",
    "purple",
    "indigo",
    "wathet",
    "turquoise",
    "yellow",
    "grey",
    "carmine",
    "violet",
    "lime",
]);
function shouldFallbackFromReplyTarget(response) {
    if (response.code !== undefined && WITHDRAWN_REPLY_ERROR_CODES.has(response.code)) {
        return true;
    }
    const msg = response.msg?.toLowerCase() ?? "";
    return msg.includes("withdrawn") || msg.includes("not found");
}
/** Check whether a thrown error indicates a withdrawn/not-found reply target. */
function isWithdrawnReplyError(err) {
    if (typeof err !== "object" || err === null) {
        return false;
    }
    // SDK error shape: err.code
    const code = err.code;
    if (typeof code === "number" && WITHDRAWN_REPLY_ERROR_CODES.has(code)) {
        return true;
    }
    // AxiosError shape: err.response.data.code
    const response = err.response;
    if (typeof response?.data?.code === "number" &&
        WITHDRAWN_REPLY_ERROR_CODES.has(response.data.code)) {
        return true;
    }
    return false;
}
/** Send a direct message as a fallback when a reply target is unavailable. */
async function sendFallbackDirect(client, params, errorPrefix) {
    const response = await client.im.message.create({
        params: { receive_id_type: params.receiveIdType },
        data: {
            receive_id: params.receiveId,
            content: params.content,
            msg_type: params.msgType,
        },
    });
    assertFeishuMessageApiSuccess(response, errorPrefix);
    return toFeishuSendResult(response, params.receiveId);
}
async function sendReplyOrFallbackDirect(client, params) {
    if (!params.replyToMessageId) {
        return sendFallbackDirect(client, params.directParams, params.directErrorPrefix);
    }
    const threadReplyFallbackError = params.replyInThread
        ? new Error("Feishu thread reply failed: reply target is unavailable and cannot safely fall back to a top-level send.")
        : null;
    let response;
    try {
        response = await client.im.message.reply({
            path: { message_id: params.replyToMessageId },
            data: {
                content: params.content,
                msg_type: params.msgType,
                ...(params.replyInThread ? { reply_in_thread: true } : {}),
            },
        });
    }
    catch (err) {
        if (!isWithdrawnReplyError(err)) {
            throw err;
        }
        if (threadReplyFallbackError) {
            throw threadReplyFallbackError;
        }
        return sendFallbackDirect(client, params.directParams, params.directErrorPrefix);
    }
    if (shouldFallbackFromReplyTarget(response)) {
        if (threadReplyFallbackError) {
            throw threadReplyFallbackError;
        }
        return sendFallbackDirect(client, params.directParams, params.directErrorPrefix);
    }
    assertFeishuMessageApiSuccess(response, params.replyErrorPrefix);
    return toFeishuSendResult(response, params.directParams.receiveId);
}
function parseInteractiveCardContent(parsed) {
    if (!parsed || typeof parsed !== "object") {
        return "[Interactive Card]";
    }
    // Support both schema 1.0 (top-level `elements`) and 2.0 (`body.elements`).
    const candidate = parsed;
    const elements = Array.isArray(candidate.elements)
        ? candidate.elements
        : Array.isArray(candidate.body?.elements)
            ? candidate.body.elements
            : null;
    if (!elements) {
        return "[Interactive Card]";
    }
    const texts = [];
    for (const element of elements) {
        if (!element || typeof element !== "object") {
            continue;
        }
        const item = element;
        if (item.tag === "div" && typeof item.text?.content === "string") {
            texts.push(item.text.content);
            continue;
        }
        if (item.tag === "markdown" && typeof item.content === "string") {
            texts.push(item.content);
        }
    }
    return texts.join("\n").trim() || "[Interactive Card]";
}
function parseFeishuMessageContent(rawContent, msgType) {
    if (!rawContent) {
        return "";
    }
    let parsed;
    try {
        parsed = JSON.parse(rawContent);
    }
    catch {
        return rawContent;
    }
    if (msgType === "text") {
        const text = parsed?.text;
        return typeof text === "string" ? text : "[Text message]";
    }
    if (msgType === "post") {
        return parsePostContent(rawContent).textContent;
    }
    if (msgType === "interactive") {
        return parseInteractiveCardContent(parsed);
    }
    if (typeof parsed === "string") {
        return parsed;
    }
    const genericText = parsed?.text;
    if (typeof genericText === "string" && genericText.trim()) {
        return genericText;
    }
    const genericTitle = parsed?.title;
    if (typeof genericTitle === "string" && genericTitle.trim()) {
        return genericTitle;
    }
    return `[${msgType || "unknown"} message]`;
}
function parseFeishuMessageItem(item, fallbackMessageId) {
    const msgType = item.msg_type ?? "text";
    const rawContent = item.body?.content ?? "";
    return {
        messageId: item.message_id ?? fallbackMessageId ?? "",
        chatId: item.chat_id ?? "",
        chatType: item.chat_type === "group" || item.chat_type === "private" || item.chat_type === "p2p"
            ? item.chat_type
            : undefined,
        senderId: item.sender?.id,
        senderOpenId: item.sender?.id_type === "open_id" ? item.sender?.id : undefined,
        senderType: item.sender?.sender_type,
        content: parseFeishuMessageContent(rawContent, msgType),
        contentType: msgType,
        createTime: item.create_time ? parseInt(String(item.create_time), 10) : undefined,
        threadId: item.thread_id || undefined,
    };
}
/**
 * Get a message by its ID.
 * Useful for fetching quoted/replied message content.
 */
export async function getMessageFeishu(params) {
    const { cfg, messageId, accountId } = params;
    const account = resolveFeishuRuntimeAccount({ cfg, accountId });
    if (!account.configured) {
        throw new Error(`Feishu account "${account.accountId}" not configured`);
    }
    const client = createFeishuClient(account);
    try {
        const response = (await client.im.message.get({
            path: { message_id: messageId },
        }));
        if (response.code !== 0) {
            return null;
        }
        // Support both list shape (data.items[0]) and single-object shape (data as message)
        const rawItem = response.data?.items?.[0] ?? response.data;
        const item = rawItem &&
            (rawItem.body !== undefined || rawItem.message_id !== undefined)
            ? rawItem
            : null;
        if (!item) {
            return null;
        }
        return parseFeishuMessageItem(item, messageId);
    }
    catch {
        return null;
    }
}
/**
 * List messages in a Feishu thread (topic).
 * Uses container_id_type=thread to directly query thread messages,
 * which includes both the root message and all replies (including bot replies).
 */
export async function listFeishuThreadMessages(params) {
    const { cfg, threadId, currentMessageId, rootMessageId, limit = 20, accountId } = params;
    const account = resolveFeishuRuntimeAccount({ cfg, accountId });
    if (!account.configured) {
        throw new Error(`Feishu account "${account.accountId}" not configured`);
    }
    const client = createFeishuClient(account);
    const response = (await client.im.message.list({
        params: {
            container_id_type: "thread",
            container_id: threadId,
            // Fetch newest messages first so long threads keep the most recent turns.
            // Results are reversed below to restore chronological order.
            sort_type: "ByCreateTimeDesc",
            page_size: Math.min(limit + 1, 50),
        },
    }));
    if (response.code !== 0) {
        throw new Error(`Feishu thread list failed: code=${response.code} msg=${response.msg ?? "unknown"}`);
    }
    const items = response.data?.items ?? [];
    const results = [];
    for (const item of items) {
        if (currentMessageId && item.message_id === currentMessageId)
            continue;
        if (rootMessageId && item.message_id === rootMessageId)
            continue;
        const parsed = parseFeishuMessageItem(item);
        results.push({
            messageId: parsed.messageId,
            senderId: parsed.senderId,
            senderType: parsed.senderType,
            content: parsed.content,
            contentType: parsed.contentType,
            createTime: parsed.createTime,
        });
        if (results.length >= limit)
            break;
    }
    // Restore chronological order (oldest first) since we fetched newest-first.
    results.reverse();
    return results;
}
export function buildFeishuPostMessagePayload(params) {
    const { messageText } = params;
    return {
        content: JSON.stringify({
            zh_cn: {
                content: [
                    [
                        {
                            tag: "md",
                            text: messageText,
                        },
                    ],
                ],
            },
        }),
        msgType: "post",
    };
}
export async function sendMessageFeishu(params) {
    const { cfg, to, text, replyToMessageId, replyInThread, mentions, accountId } = params;
    const { client, receiveId, receiveIdType } = resolveFeishuSendTarget({ cfg, to, accountId });
    const tableMode = resolveMarkdownTableMode({
        cfg,
        channel: "feishu",
    });
    // Build message content (with @mention support)
    let rawText = text ?? "";
    if (mentions && mentions.length > 0) {
        rawText = buildMentionedMessage(mentions, rawText);
    }
    const messageText = convertMarkdownTables(rawText, tableMode);
    const { content, msgType } = buildFeishuPostMessagePayload({ messageText });
    const directParams = { receiveId, receiveIdType, content, msgType };
    return sendReplyOrFallbackDirect(client, {
        replyToMessageId,
        replyInThread,
        content,
        msgType,
        directParams,
        directErrorPrefix: "Feishu send failed",
        replyErrorPrefix: "Feishu reply failed",
    });
}
export async function sendCardFeishu(params) {
    const { cfg, to, card, replyToMessageId, replyInThread, accountId } = params;
    const { client, receiveId, receiveIdType } = resolveFeishuSendTarget({ cfg, to, accountId });
    const content = JSON.stringify(card);
    const directParams = { receiveId, receiveIdType, content, msgType: "interactive" };
    return sendReplyOrFallbackDirect(client, {
        replyToMessageId,
        replyInThread,
        content,
        msgType: "interactive",
        directParams,
        directErrorPrefix: "Feishu card send failed",
        replyErrorPrefix: "Feishu card reply failed",
    });
}
export async function editMessageFeishu(params) {
    const { cfg, messageId, text, card, accountId } = params;
    const account = resolveFeishuRuntimeAccount({ cfg, accountId });
    if (!account.configured) {
        throw new Error(`Feishu account "${account.accountId}" not configured`);
    }
    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasCard = Boolean(card);
    if (hasText === hasCard) {
        throw new Error("Feishu edit requires exactly one of text or card.");
    }
    const client = createFeishuClient(account);
    if (card) {
        const content = JSON.stringify(card);
        const response = await client.im.message.patch({
            path: { message_id: messageId },
            data: { content },
        });
        if (response.code !== 0) {
            throw new Error(`Feishu message edit failed: ${response.msg || `code ${response.code}`}`);
        }
        return { messageId, contentType: "interactive" };
    }
    const tableMode = resolveMarkdownTableMode({
        cfg,
        channel: "feishu",
    });
    const messageText = convertMarkdownTables(text, tableMode);
    const payload = buildFeishuPostMessagePayload({ messageText });
    const response = await client.im.message.patch({
        path: { message_id: messageId },
        data: { content: payload.content },
    });
    if (response.code !== 0) {
        throw new Error(`Feishu message edit failed: ${response.msg || `code ${response.code}`}`);
    }
    return { messageId, contentType: "post" };
}
export async function updateCardFeishu(params) {
    const { cfg, messageId, card, accountId } = params;
    const account = resolveFeishuRuntimeAccount({ cfg, accountId });
    if (!account.configured) {
        throw new Error(`Feishu account "${account.accountId}" not configured`);
    }
    const client = createFeishuClient(account);
    const content = JSON.stringify(card);
    const response = await client.im.message.patch({
        path: { message_id: messageId },
        data: { content },
    });
    if (response.code !== 0) {
        throw new Error(`Feishu card update failed: ${response.msg || `code ${response.code}`}`);
    }
}
/**
 * Build a Feishu interactive card with markdown content.
 * Cards render markdown properly (code blocks, tables, links, etc.)
 * Uses schema 2.0 format for proper markdown rendering.
 */
export function buildMarkdownCard(text) {
    return {
        schema: "2.0",
        config: {
            wide_screen_mode: true,
        },
        body: {
            elements: [
                {
                    tag: "markdown",
                    content: text,
                },
            ],
        },
    };
}
export function resolveFeishuCardTemplate(template) {
    const normalized = template?.trim().toLowerCase();
    if (!normalized || !FEISHU_CARD_TEMPLATES.has(normalized)) {
        return undefined;
    }
    return normalized;
}
/**
 * Build a Feishu interactive card with optional header and note footer.
 * When header/note are omitted, behaves identically to buildMarkdownCard.
 */
export function buildStructuredCard(text, options) {
    const elements = [{ tag: "markdown", content: text }];
    if (options?.note) {
        elements.push({ tag: "hr" });
        elements.push({ tag: "markdown", content: `<font color='grey'>${options.note}</font>` });
    }
    const card = {
        schema: "2.0",
        config: { wide_screen_mode: true },
        body: { elements },
    };
    if (options?.header) {
        card.header = {
            title: { tag: "plain_text", content: options.header.title },
            template: resolveFeishuCardTemplate(options.header.template) ?? "blue",
        };
    }
    return card;
}
/**
 * Send a message as a structured card with optional header and note.
 */
export async function sendStructuredCardFeishu(params) {
    const { cfg, to, text, replyToMessageId, replyInThread, mentions, accountId, header, note } = params;
    let cardText = text;
    if (mentions && mentions.length > 0) {
        cardText = buildMentionedCardContent(mentions, text);
    }
    const card = buildStructuredCard(cardText, { header, note });
    return sendCardFeishu({ cfg, to, card, replyToMessageId, replyInThread, accountId });
}
/**
 * Send a message as a markdown card (interactive message).
 * This renders markdown properly in Feishu (code blocks, tables, bold/italic, etc.)
 */
export async function sendMarkdownCardFeishu(params) {
    const { cfg, to, text, replyToMessageId, replyInThread, mentions, accountId } = params;
    let cardText = text;
    if (mentions && mentions.length > 0) {
        cardText = buildMentionedCardContent(mentions, text);
    }
    const card = buildMarkdownCard(cardText);
    return sendCardFeishu({ cfg, to, card, replyToMessageId, replyInThread, accountId });
}
