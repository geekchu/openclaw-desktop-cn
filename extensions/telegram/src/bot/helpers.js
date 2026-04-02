import { formatLocationText } from "openclaw/plugin-sdk/channel-inbound";
import { resolveTelegramPreviewStreamMode } from "openclaw/plugin-sdk/config-runtime";
import { readChannelAllowFromStore } from "openclaw/plugin-sdk/conversation-runtime";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { firstDefined, normalizeAllowFrom } from "../bot-access.js";
import { normalizeTelegramReplyToMessageId } from "../outbound-params.js";
const TELEGRAM_GENERAL_TOPIC_ID = 1;
export function extractTelegramForumFlag(value) {
    if (!value || typeof value !== "object" || !("is_forum" in value)) {
        return undefined;
    }
    const forum = value.is_forum;
    return typeof forum === "boolean" ? forum : undefined;
}
export async function resolveTelegramForumFlag(params) {
    if (typeof params.isForum === "boolean") {
        return params.isForum;
    }
    if (!params.isGroup || params.chatType !== "supergroup" || !params.getChat) {
        return false;
    }
    try {
        return extractTelegramForumFlag(await params.getChat(params.chatId)) === true;
    }
    catch {
        return false;
    }
}
// Preserve recovered forum metadata so downstream handlers do not need to re-query getChat.
export function withResolvedTelegramForumFlag(message, isForum) {
    const current = extractTelegramForumFlag(message.chat);
    if (current === isForum) {
        return message;
    }
    return {
        ...message,
        chat: {
            ...message.chat,
            is_forum: isForum,
        },
    };
}
export async function resolveTelegramGroupAllowFromContext(params) {
    const accountId = normalizeAccountId(params.accountId);
    // Use resolveTelegramThreadSpec to handle both forum groups AND DM topics
    const threadSpec = resolveTelegramThreadSpec({
        isGroup: params.isGroup ?? false,
        isForum: params.isForum,
        messageThreadId: params.messageThreadId,
    });
    const resolvedThreadId = threadSpec.scope === "forum" ? threadSpec.id : undefined;
    const dmThreadId = threadSpec.scope === "dm" ? threadSpec.id : undefined;
    const threadIdForConfig = resolvedThreadId ?? dmThreadId;
    const storeAllowFrom = await (params.readChannelAllowFromStore ?? readChannelAllowFromStore)("telegram", process.env, accountId).catch(() => []);
    const { groupConfig, topicConfig } = params.resolveTelegramGroupConfig(params.chatId, threadIdForConfig);
    const groupAllowOverride = firstDefined(topicConfig?.allowFrom, groupConfig?.allowFrom);
    // Group sender access must remain explicit (groupAllowFrom/per-group allowFrom only).
    // DM pairing store entries are not a group authorization source.
    const effectiveGroupAllow = normalizeAllowFrom(groupAllowOverride ?? params.groupAllowFrom);
    const hasGroupAllowOverride = typeof groupAllowOverride !== "undefined";
    return {
        resolvedThreadId,
        dmThreadId,
        storeAllowFrom,
        groupConfig,
        topicConfig,
        groupAllowOverride,
        effectiveGroupAllow,
        hasGroupAllowOverride,
    };
}
/**
 * Resolve the thread ID for Telegram forum topics.
 * For non-forum groups, returns undefined even if messageThreadId is present
 * (reply threads in regular groups should not create separate sessions).
 * For forum groups, returns the topic ID (or General topic ID=1 if unspecified).
 */
export function resolveTelegramForumThreadId(params) {
    // Non-forum groups: ignore message_thread_id (reply threads are not real topics)
    if (!params.isForum) {
        return undefined;
    }
    // Forum groups: use the topic ID, defaulting to General topic
    if (params.messageThreadId == null) {
        return TELEGRAM_GENERAL_TOPIC_ID;
    }
    return params.messageThreadId;
}
export function resolveTelegramThreadSpec(params) {
    if (params.isGroup) {
        const id = resolveTelegramForumThreadId({
            isForum: params.isForum,
            messageThreadId: params.messageThreadId,
        });
        return {
            id,
            scope: params.isForum ? "forum" : "none",
        };
    }
    if (params.messageThreadId == null) {
        return { scope: "dm" };
    }
    return {
        id: params.messageThreadId,
        scope: "dm",
    };
}
/**
 * Build thread params for Telegram API calls (messages, media).
 *
 * IMPORTANT: Thread IDs behave differently based on chat type:
 * - DMs (private chats): Include message_thread_id when present (DM topics)
 * - Forum topics: Skip thread_id=1 (General topic), include others
 * - Regular groups: Thread IDs are ignored by Telegram
 *
 * General forum topic (id=1) must be treated like a regular supergroup send:
 * Telegram rejects sendMessage/sendMedia with message_thread_id=1 ("thread not found").
 *
 * @param thread - Thread specification with ID and scope
 * @returns API params object or undefined if thread_id should be omitted
 */
export function buildTelegramThreadParams(thread) {
    if (thread?.id == null) {
        return undefined;
    }
    const normalized = Math.trunc(thread.id);
    if (thread.scope === "dm") {
        return normalized > 0 ? { message_thread_id: normalized } : undefined;
    }
    // Telegram rejects message_thread_id=1 for General forum topic
    if (normalized === TELEGRAM_GENERAL_TOPIC_ID) {
        return undefined;
    }
    return { message_thread_id: normalized };
}
/**
 * Build a Telegram routing target that keeps real topic/thread ids in-band.
 *
 * This is used by generic reply plumbing that may not always carry a separate
 * `threadId` field through every hop. General forum topic stays chat-scoped
 * because Telegram rejects `message_thread_id=1` for message sends.
 */
export function buildTelegramRoutingTarget(chatId, thread) {
    const base = `telegram:${chatId}`;
    const threadParams = buildTelegramThreadParams(thread);
    const messageThreadId = threadParams?.message_thread_id;
    if (typeof messageThreadId !== "number") {
        return base;
    }
    return `${base}:topic:${messageThreadId}`;
}
/**
 * Build thread params for typing indicators (sendChatAction).
 * Empirically, General topic (id=1) needs message_thread_id for typing to appear.
 */
export function buildTypingThreadParams(messageThreadId) {
    if (messageThreadId == null) {
        return undefined;
    }
    return { message_thread_id: Math.trunc(messageThreadId) };
}
export function resolveTelegramStreamMode(telegramCfg) {
    return resolveTelegramPreviewStreamMode(telegramCfg);
}
export function buildTelegramGroupPeerId(chatId, messageThreadId) {
    return messageThreadId != null ? `${chatId}:topic:${messageThreadId}` : String(chatId);
}
/**
 * Resolve the direct-message peer identifier for Telegram routing/session keys.
 *
 * In some Telegram DM deliveries (for example certain business/chat bridge flows),
 * `chat.id` can differ from the actual sender user id. Prefer sender id when present
 * so per-peer DM scopes isolate users correctly.
 */
export function resolveTelegramDirectPeerId(params) {
    const senderId = params.senderId != null ? String(params.senderId).trim() : "";
    if (senderId) {
        return senderId;
    }
    return String(params.chatId);
}
export function buildTelegramGroupFrom(chatId, messageThreadId) {
    return `telegram:group:${buildTelegramGroupPeerId(chatId, messageThreadId)}`;
}
/**
 * Build parentPeer for forum topic binding inheritance.
 * When a message comes from a forum topic, the peer ID includes the topic suffix
 * (e.g., `-1001234567890:topic:99`). To allow bindings configured for the base
 * group ID to match, we provide the parent group as `parentPeer` so the routing
 * layer can fall back to it when the exact peer doesn't match.
 */
export function buildTelegramParentPeer(params) {
    if (!params.isGroup || params.resolvedThreadId == null) {
        return undefined;
    }
    return { kind: "group", id: String(params.chatId) };
}
export function buildSenderName(msg) {
    const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim() ||
        msg.from?.username;
    return name || undefined;
}
export function resolveTelegramMediaPlaceholder(msg) {
    if (!msg) {
        return undefined;
    }
    if (msg.photo) {
        return "<media:image>";
    }
    if (msg.video || msg.video_note) {
        return "<media:video>";
    }
    if (msg.audio || msg.voice) {
        return "<media:audio>";
    }
    if (msg.document) {
        return "<media:document>";
    }
    if (msg.sticker) {
        return "<media:sticker>";
    }
    return undefined;
}
export function buildSenderLabel(msg, senderId) {
    const name = buildSenderName(msg);
    const username = msg.from?.username ? `@${msg.from.username}` : undefined;
    let label = name;
    if (name && username) {
        label = `${name} (${username})`;
    }
    else if (!name && username) {
        label = username;
    }
    const normalizedSenderId = senderId != null && `${senderId}`.trim() ? `${senderId}`.trim() : undefined;
    const fallbackId = normalizedSenderId ?? (msg.from?.id != null ? String(msg.from.id) : undefined);
    const idPart = fallbackId ? `id:${fallbackId}` : undefined;
    if (label && idPart) {
        return `${label} ${idPart}`;
    }
    if (label) {
        return label;
    }
    return idPart ?? "id:unknown";
}
export function buildGroupLabel(msg, chatId, messageThreadId) {
    const title = msg.chat?.title;
    const topicSuffix = messageThreadId != null ? ` topic:${messageThreadId}` : "";
    if (title) {
        return `${title} id:${chatId}${topicSuffix}`;
    }
    return `group:${chatId}${topicSuffix}`;
}
export function getTelegramTextParts(msg) {
    const text = msg.text ?? msg.caption ?? "";
    const entities = msg.entities ?? msg.caption_entities ?? [];
    return { text, entities };
}
function isTelegramMentionWordChar(char) {
    return char != null && /[a-z0-9_]/i.test(char);
}
function hasStandaloneTelegramMention(text, mention) {
    let startIndex = 0;
    while (startIndex < text.length) {
        const idx = text.indexOf(mention, startIndex);
        if (idx === -1) {
            return false;
        }
        const prev = idx > 0 ? text[idx - 1] : undefined;
        const next = text[idx + mention.length];
        if (!isTelegramMentionWordChar(prev) && !isTelegramMentionWordChar(next)) {
            return true;
        }
        startIndex = idx + 1;
    }
    return false;
}
export function hasBotMention(msg, botUsername) {
    const { text, entities } = getTelegramTextParts(msg);
    const mention = `@${botUsername}`.toLowerCase();
    if (hasStandaloneTelegramMention(text.toLowerCase(), mention)) {
        return true;
    }
    for (const ent of entities) {
        if (ent.type !== "mention") {
            continue;
        }
        const slice = text.slice(ent.offset, ent.offset + ent.length);
        if (slice.toLowerCase() === mention) {
            return true;
        }
    }
    return false;
}
export function expandTextLinks(text, entities) {
    if (!text || !entities?.length) {
        return text;
    }
    const textLinks = entities
        .filter((entity) => entity.type === "text_link" && Boolean(entity.url))
        .toSorted((a, b) => b.offset - a.offset);
    if (textLinks.length === 0) {
        return text;
    }
    let result = text;
    for (const entity of textLinks) {
        const linkText = text.slice(entity.offset, entity.offset + entity.length);
        const markdown = `[${linkText}](${entity.url})`;
        result =
            result.slice(0, entity.offset) + markdown + result.slice(entity.offset + entity.length);
    }
    return result;
}
export function resolveTelegramReplyId(raw) {
    return normalizeTelegramReplyToMessageId(raw);
}
export function describeReplyTarget(msg) {
    const reply = msg.reply_to_message;
    const externalReply = msg.external_reply;
    const quoteText = msg.quote?.text ??
        externalReply?.quote?.text;
    let body = "";
    let kind = "reply";
    if (typeof quoteText === "string") {
        body = quoteText.trim();
        if (body) {
            kind = "quote";
        }
    }
    const replyLike = reply ?? externalReply;
    if (!body && replyLike) {
        const replyBody = (typeof replyLike.text === "string"
            ? replyLike.text
            : typeof replyLike.caption === "string"
                ? replyLike.caption
                : "").trim();
        body = replyBody;
        if (!body) {
            body = resolveTelegramMediaPlaceholder(replyLike) ?? "";
            if (!body) {
                const locationData = extractTelegramLocation(replyLike);
                if (locationData) {
                    body = formatLocationText(locationData);
                }
            }
        }
    }
    if (!body) {
        return null;
    }
    const sender = replyLike ? buildSenderName(replyLike) : undefined;
    const senderLabel = sender ?? "unknown sender";
    // Extract forward context from the resolved reply target (reply_to_message or external_reply).
    const forwardedFrom = replyLike?.forward_origin
        ? (resolveForwardOrigin(replyLike.forward_origin) ?? undefined)
        : undefined;
    return {
        id: replyLike?.message_id ? String(replyLike.message_id) : undefined,
        sender: senderLabel,
        body,
        kind,
        forwardedFrom,
    };
}
function normalizeForwardedUserLabel(user) {
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    const username = user.username?.trim() || undefined;
    const id = String(user.id);
    const display = (name && username
        ? `${name} (@${username})`
        : name || (username ? `@${username}` : undefined)) || `user:${id}`;
    return { display, name: name || undefined, username, id };
}
function normalizeForwardedChatLabel(chat, fallbackKind) {
    const title = chat.title?.trim() || undefined;
    const username = chat.username?.trim() || undefined;
    const id = String(chat.id);
    const display = title || (username ? `@${username}` : undefined) || `${fallbackKind}:${id}`;
    return { display, title, username, id };
}
function buildForwardedContextFromUser(params) {
    const { display, name, username, id } = normalizeForwardedUserLabel(params.user);
    if (!display) {
        return null;
    }
    return {
        from: display,
        date: params.date,
        fromType: params.type,
        fromId: id,
        fromUsername: username,
        fromTitle: name,
    };
}
function buildForwardedContextFromHiddenName(params) {
    const trimmed = params.name?.trim();
    if (!trimmed) {
        return null;
    }
    return {
        from: trimmed,
        date: params.date,
        fromType: params.type,
        fromTitle: trimmed,
    };
}
function buildForwardedContextFromChat(params) {
    const fallbackKind = params.type === "channel" ? "channel" : "chat";
    const { display, title, username, id } = normalizeForwardedChatLabel(params.chat, fallbackKind);
    if (!display) {
        return null;
    }
    const signature = params.signature?.trim() || undefined;
    const from = signature ? `${display} (${signature})` : display;
    const chatType = (params.chat.type?.trim() || undefined);
    return {
        from,
        date: params.date,
        fromType: params.type,
        fromId: id,
        fromUsername: username,
        fromTitle: title,
        fromSignature: signature,
        fromChatType: chatType,
        fromMessageId: params.messageId,
    };
}
function resolveForwardOrigin(origin) {
    switch (origin.type) {
        case "user":
            return buildForwardedContextFromUser({
                user: origin.sender_user,
                date: origin.date,
                type: "user",
            });
        case "hidden_user":
            return buildForwardedContextFromHiddenName({
                name: origin.sender_user_name,
                date: origin.date,
                type: "hidden_user",
            });
        case "chat":
            return buildForwardedContextFromChat({
                chat: origin.sender_chat,
                date: origin.date,
                type: "chat",
                signature: origin.author_signature,
            });
        case "channel":
            return buildForwardedContextFromChat({
                chat: origin.chat,
                date: origin.date,
                type: "channel",
                signature: origin.author_signature,
                messageId: origin.message_id,
            });
        default:
            // Exhaustiveness guard: if Grammy adds a new MessageOrigin variant,
            // TypeScript will flag this assignment as an error.
            origin;
            return null;
    }
}
/** Extract forwarded message origin info from Telegram message. */
export function normalizeForwardedContext(msg) {
    if (!msg.forward_origin) {
        return null;
    }
    return resolveForwardOrigin(msg.forward_origin);
}
export function extractTelegramLocation(msg) {
    const { venue, location } = msg;
    if (venue) {
        return {
            latitude: venue.location.latitude,
            longitude: venue.location.longitude,
            accuracy: venue.location.horizontal_accuracy,
            name: venue.title,
            address: venue.address,
            source: "place",
            isLive: false,
        };
    }
    if (location) {
        const isLive = typeof location.live_period === "number" && location.live_period > 0;
        return {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.horizontal_accuracy,
            source: isLive ? "live" : "pin",
            isLive,
        };
    }
    return null;
}
