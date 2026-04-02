import { Bot, HttpError } from "grammy";
import * as grammy from "grammy";
import { recordChannelActivity } from "openclaw/plugin-sdk/channel-runtime";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolveMarkdownTableMode } from "openclaw/plugin-sdk/config-runtime";
import { isDiagnosticFlagEnabled } from "openclaw/plugin-sdk/diagnostic-runtime";
import { formatUncaughtError } from "openclaw/plugin-sdk/error-runtime";
import { buildOutboundMediaLoadOptions } from "openclaw/plugin-sdk/media-runtime";
import { getImageMetadata } from "openclaw/plugin-sdk/media-runtime";
import { isGifMedia, kindFromMime } from "openclaw/plugin-sdk/media-runtime";
import { normalizePollInput } from "openclaw/plugin-sdk/media-runtime";
import { createTelegramRetryRunner } from "openclaw/plugin-sdk/retry-runtime";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import { redactSensitiveText } from "openclaw/plugin-sdk/text-runtime";
import { loadWebMedia } from "openclaw/plugin-sdk/web-media";
import { resolveTelegramAccount } from "./accounts.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";
import { buildTelegramThreadParams, buildTypingThreadParams } from "./bot/helpers.js";
import { splitTelegramCaption } from "./caption.js";
import { resolveTelegramFetch } from "./fetch.js";
import { renderTelegramHtmlText, splitTelegramHtmlChunks } from "./format.js";
import { isRecoverableTelegramNetworkError, isSafeToRetrySendError, isTelegramServerError, } from "./network-errors.js";
import { makeProxyFetch } from "./proxy.js";
import { recordSentMessage } from "./sent-message-cache.js";
import { maybePersistResolvedTelegramTarget } from "./target-writeback.js";
import { normalizeTelegramChatId, normalizeTelegramLookupTarget, parseTelegramTarget, } from "./targets.js";
import { normalizeTelegramReplyToMessageId } from "./outbound-params.js";
import { resolveTelegramVoiceSend } from "./voice.js";
const InputFileCtor = grammy.InputFile;
const MAX_TELEGRAM_PHOTO_DIMENSION_SUM = 10_000;
const MAX_TELEGRAM_PHOTO_ASPECT_RATIO = 20;
function resolveTelegramMessageIdOrThrow(result, context) {
    if (typeof result?.message_id === "number" && Number.isFinite(result.message_id)) {
        return Math.trunc(result.message_id);
    }
    throw new Error(`Telegram ${context} returned no message_id`);
}
function splitTelegramPlainTextChunks(text, limit) {
    if (!text) {
        return [];
    }
    const normalizedLimit = Math.max(1, Math.floor(limit));
    const chunks = [];
    for (let start = 0; start < text.length; start += normalizedLimit) {
        chunks.push(text.slice(start, start + normalizedLimit));
    }
    return chunks;
}
function splitTelegramPlainTextFallback(text, chunkCount, limit) {
    if (!text) {
        return [];
    }
    const normalizedLimit = Math.max(1, Math.floor(limit));
    const fixedChunks = splitTelegramPlainTextChunks(text, normalizedLimit);
    if (chunkCount <= 1 || fixedChunks.length >= chunkCount) {
        return fixedChunks;
    }
    const chunks = [];
    let offset = 0;
    for (let index = 0; index < chunkCount; index += 1) {
        const remainingChars = text.length - offset;
        const remainingChunks = chunkCount - index;
        const nextChunkLength = remainingChunks === 1
            ? remainingChars
            : Math.min(normalizedLimit, Math.ceil(remainingChars / remainingChunks));
        chunks.push(text.slice(offset, offset + nextChunkLength));
        offset += nextChunkLength;
    }
    return chunks;
}
const PARSE_ERR_RE = /can't parse entities|parse entities|find end of the entity/i;
const THREAD_NOT_FOUND_RE = /400:\s*Bad Request:\s*message thread not found/i;
const MESSAGE_NOT_MODIFIED_RE = /400:\s*Bad Request:\s*message is not modified|MESSAGE_NOT_MODIFIED/i;
const CHAT_NOT_FOUND_RE = /400: Bad Request: chat not found/i;
const sendLogger = createSubsystemLogger("telegram/send");
const diagLogger = createSubsystemLogger("telegram/diagnostic");
const telegramClientOptionsCache = new Map();
const MAX_TELEGRAM_CLIENT_OPTIONS_CACHE_SIZE = 64;
function asTelegramClientFetch(fetchImpl) {
    return fetchImpl;
}
export function resetTelegramClientOptionsCacheForTests() {
    telegramClientOptionsCache.clear();
}
function createTelegramHttpLogger(cfg) {
    const enabled = isDiagnosticFlagEnabled("telegram.http", cfg);
    if (!enabled) {
        return () => { };
    }
    return (label, err) => {
        if (!(err instanceof HttpError)) {
            return;
        }
        const detail = redactSensitiveText(formatUncaughtError(err.error ?? err));
        diagLogger.warn(`telegram http error (${label}): ${detail}`);
    };
}
function shouldUseTelegramClientOptionsCache() {
    return !process.env.VITEST && process.env.NODE_ENV !== "test";
}
function buildTelegramClientOptionsCacheKey(params) {
    const proxyKey = params.account.config.proxy?.trim() ?? "";
    const autoSelectFamily = params.account.config.network?.autoSelectFamily;
    const autoSelectFamilyKey = typeof autoSelectFamily === "boolean" ? String(autoSelectFamily) : "default";
    const dnsResultOrderKey = params.account.config.network?.dnsResultOrder ?? "default";
    const apiRootKey = params.account.config.apiRoot?.trim() ?? "";
    const timeoutSecondsKey = typeof params.timeoutSeconds === "number" ? String(params.timeoutSeconds) : "default";
    return `${params.account.accountId}::${proxyKey}::${autoSelectFamilyKey}::${dnsResultOrderKey}::${apiRootKey}::${timeoutSecondsKey}`;
}
function setCachedTelegramClientOptions(cacheKey, clientOptions) {
    telegramClientOptionsCache.set(cacheKey, clientOptions);
    if (telegramClientOptionsCache.size > MAX_TELEGRAM_CLIENT_OPTIONS_CACHE_SIZE) {
        const oldestKey = telegramClientOptionsCache.keys().next().value;
        if (oldestKey !== undefined) {
            telegramClientOptionsCache.delete(oldestKey);
        }
    }
    return clientOptions;
}
function resolveTelegramClientOptions(account) {
    const timeoutSeconds = typeof account.config.timeoutSeconds === "number" &&
        Number.isFinite(account.config.timeoutSeconds)
        ? Math.max(1, Math.floor(account.config.timeoutSeconds))
        : undefined;
    const cacheEnabled = shouldUseTelegramClientOptionsCache();
    const cacheKey = cacheEnabled
        ? buildTelegramClientOptionsCacheKey({
            account,
            timeoutSeconds,
        })
        : null;
    if (cacheKey && telegramClientOptionsCache.has(cacheKey)) {
        return telegramClientOptionsCache.get(cacheKey);
    }
    const proxyUrl = account.config.proxy?.trim();
    const proxyFetch = proxyUrl ? makeProxyFetch(proxyUrl) : undefined;
    const apiRoot = account.config.apiRoot?.trim() || undefined;
    const fetchImpl = resolveTelegramFetch(proxyFetch, {
        network: account.config.network,
    });
    const clientOptions = fetchImpl || timeoutSeconds || apiRoot
        ? {
            ...(fetchImpl ? { fetch: asTelegramClientFetch(fetchImpl) } : {}),
            ...(timeoutSeconds ? { timeoutSeconds } : {}),
            ...(apiRoot ? { apiRoot } : {}),
        }
        : undefined;
    if (cacheKey) {
        return setCachedTelegramClientOptions(cacheKey, clientOptions);
    }
    return clientOptions;
}
function resolveToken(explicit, params) {
    if (explicit?.trim()) {
        return explicit.trim();
    }
    if (!params.token) {
        throw new Error(`Telegram bot token missing for account "${params.accountId}" (set channels.telegram.accounts.${params.accountId}.botToken/tokenFile or TELEGRAM_BOT_TOKEN for default).`);
    }
    return params.token.trim();
}
async function resolveChatId(to, params) {
    const numericChatId = normalizeTelegramChatId(to);
    if (numericChatId) {
        return numericChatId;
    }
    const lookupTarget = normalizeTelegramLookupTarget(to);
    const getChat = params.api.getChat;
    if (!lookupTarget || typeof getChat !== "function") {
        throw new Error("Telegram recipient must be a numeric chat ID");
    }
    try {
        const chat = await getChat.call(params.api, lookupTarget);
        const resolved = normalizeTelegramChatId(String(chat?.id ?? ""));
        if (!resolved) {
            throw new Error(`resolved chat id is not numeric (${String(chat?.id ?? "")})`);
        }
        if (params.verbose) {
            sendLogger.warn(`telegram recipient ${lookupTarget} resolved to numeric chat id ${resolved}`);
        }
        return resolved;
    }
    catch (err) {
        const detail = formatErrorMessage(err);
        throw new Error(`Telegram recipient ${lookupTarget} could not be resolved to a numeric chat ID (${detail})`, { cause: err });
    }
}
async function resolveAndPersistChatId(params) {
    const chatId = await resolveChatId(params.lookupTarget, {
        api: params.api,
        verbose: params.verbose,
    });
    await maybePersistResolvedTelegramTarget({
        cfg: params.cfg,
        rawTarget: params.persistTarget,
        resolvedChatId: chatId,
        verbose: params.verbose,
        gatewayClientScopes: params.gatewayClientScopes,
    });
    return chatId;
}
function normalizeMessageId(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return Math.trunc(raw);
    }
    if (typeof raw === "string") {
        const value = raw.trim();
        if (!value) {
            throw new Error("Message id is required for Telegram actions");
        }
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    throw new Error("Message id is required for Telegram actions");
}
function isTelegramThreadNotFoundError(err) {
    return THREAD_NOT_FOUND_RE.test(formatErrorMessage(err));
}
function isTelegramMessageNotModifiedError(err) {
    return MESSAGE_NOT_MODIFIED_RE.test(formatErrorMessage(err));
}
function hasMessageThreadIdParam(params) {
    if (!params) {
        return false;
    }
    const value = params.message_thread_id;
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    return false;
}
function removeMessageThreadIdParam(params) {
    if (!params || !hasMessageThreadIdParam(params)) {
        return params;
    }
    const next = { ...params };
    delete next.message_thread_id;
    return (Object.keys(next).length > 0 ? next : undefined);
}
function isTelegramHtmlParseError(err) {
    return PARSE_ERR_RE.test(formatErrorMessage(err));
}
function buildTelegramThreadReplyParams(params) {
    const messageThreadId = params.messageThreadId != null ? params.messageThreadId : params.targetMessageThreadId;
    const threadScope = params.chatType === "direct" ? "dm" : "forum";
    // Never blanket-strip DM message_thread_id by chat-id sign.
    // Telegram supports DM topics; stripping silently misroutes topic replies.
    // Keep thread id and rely on thread-not-found retry fallback for plain DMs.
    const threadSpec = messageThreadId != null ? { id: messageThreadId, scope: threadScope } : undefined;
    const threadIdParams = buildTelegramThreadParams(threadSpec);
    const threadParams = threadIdParams ? { ...threadIdParams } : {};
    const replyToMessageId = normalizeTelegramReplyToMessageId(params.replyToMessageId);
    if (replyToMessageId != null) {
        if (params.quoteText?.trim()) {
            threadParams.reply_parameters = {
                message_id: replyToMessageId,
                quote: params.quoteText.trim(),
                allow_sending_without_reply: true,
            };
        }
        else {
            threadParams.reply_to_message_id = replyToMessageId;
            threadParams.allow_sending_without_reply = true;
        }
    }
    return threadParams;
}
async function withTelegramHtmlParseFallback(params) {
    try {
        return await params.requestHtml(params.label);
    }
    catch (err) {
        if (!isTelegramHtmlParseError(err)) {
            throw err;
        }
        if (params.verbose) {
            sendLogger.warn(`telegram ${params.label} failed with HTML parse error, retrying as plain text: ${formatErrorMessage(err)}`);
        }
        return await params.requestPlain(`${params.label}-plain`);
    }
}
function resolveTelegramApiContext(opts) {
    const cfg = opts.cfg ?? loadConfig();
    const account = resolveTelegramAccount({
        cfg,
        accountId: opts.accountId,
    });
    const token = resolveToken(opts.token, account);
    const client = resolveTelegramClientOptions(account);
    const api = (opts.api ?? new Bot(token, client ? { client } : undefined).api);
    return { cfg, account, api };
}
function createTelegramRequestWithDiag(params) {
    const request = createTelegramRetryRunner({
        retry: params.retry,
        configRetry: params.account.config.retry,
        verbose: params.verbose,
        ...(params.shouldRetry ? { shouldRetry: params.shouldRetry } : {}),
        ...(params.strictShouldRetry ? { strictShouldRetry: true } : {}),
    });
    const logHttpError = createTelegramHttpLogger(params.cfg);
    return (fn, label, options) => {
        const runRequest = () => request(fn, label);
        const call = params.useApiErrorLogging === false
            ? runRequest()
            : withTelegramApiErrorLogging({
                operation: label ?? "request",
                fn: runRequest,
                ...(options?.shouldLog ? { shouldLog: options.shouldLog } : {}),
            });
        return call.catch((err) => {
            logHttpError(label ?? "request", err);
            throw err;
        });
    };
}
function wrapTelegramChatNotFoundError(err, params) {
    const errorMsg = formatErrorMessage(err);
    // Check for 403 "bot is not a member" or "bot was blocked" errors
    if (/403.*(bot.*not.*member|bot.*blocked|bot.*kicked)/i.test(errorMsg)) {
        return new Error([
            `Telegram send failed: bot is not a member of the chat, was blocked, or was kicked (chat_id=${params.chatId}).`,
            `Telegram API said: ${errorMsg}.`,
            "Fix: Add the bot to the channel/group, or ensure it has not been removed/blocked/kicked by the user.",
            `Input was: ${JSON.stringify(params.input)}.`,
        ].join(" "));
    }
    if (!CHAT_NOT_FOUND_RE.test(errorMsg)) {
        return err;
    }
    return new Error([
        `Telegram send failed: chat not found (chat_id=${params.chatId}).`,
        "Likely: bot not started in DM, bot removed from group/channel, group migrated (new -100… id), or wrong bot token.",
        `Input was: ${JSON.stringify(params.input)}.`,
    ].join(" "));
}
async function withTelegramThreadFallback(params, label, verbose, attempt) {
    try {
        return await attempt(params, label);
    }
    catch (err) {
        // Do not widen this fallback to cover "chat not found".
        // chat-not-found is routing/auth/membership/token; stripping thread IDs hides root cause.
        if (!hasMessageThreadIdParam(params) || !isTelegramThreadNotFoundError(err)) {
            throw err;
        }
        if (verbose) {
            sendLogger.warn(`telegram ${label} failed with message_thread_id, retrying without thread: ${formatErrorMessage(err)}`);
        }
        const retriedParams = removeMessageThreadIdParam(params);
        return await attempt(retriedParams, `${label}-threadless`);
    }
}
function createRequestWithChatNotFound(params) {
    return async (fn, label) => params.requestWithDiag(fn, label).catch((err) => {
        throw wrapTelegramChatNotFoundError(err, {
            chatId: params.chatId,
            input: params.input,
        });
    });
}
function createTelegramNonIdempotentRequestWithDiag(params) {
    return createTelegramRequestWithDiag({
        cfg: params.cfg,
        account: params.account,
        retry: params.retry,
        verbose: params.verbose,
        useApiErrorLogging: params.useApiErrorLogging,
        shouldRetry: (err) => isSafeToRetrySendError(err),
        strictShouldRetry: true,
    });
}
export function buildInlineKeyboard(buttons) {
    if (!buttons?.length) {
        return undefined;
    }
    const rows = buttons
        .map((row) => row
        .filter((button) => button?.text && button?.callback_data)
        .map((button) => ({
        text: button.text,
        callback_data: button.callback_data,
        ...(button.style ? { style: button.style } : {}),
    })))
        .filter((row) => row.length > 0);
    if (rows.length === 0) {
        return undefined;
    }
    return { inline_keyboard: rows };
}
export async function sendMessageTelegram(to, text, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const target = parseTelegramTarget(to);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: target.chatId,
        persistTarget: to,
        verbose: opts.verbose,
        gatewayClientScopes: opts.gatewayClientScopes,
    });
    const mediaUrl = opts.mediaUrl?.trim();
    const mediaMaxBytes = opts.maxBytes ??
        (typeof account.config.mediaMaxMb === "number" ? account.config.mediaMaxMb : 100) * 1024 * 1024;
    const replyMarkup = buildInlineKeyboard(opts.buttons);
    const threadParams = buildTelegramThreadReplyParams({
        targetMessageThreadId: target.messageThreadId,
        messageThreadId: opts.messageThreadId,
        chatType: target.chatType,
        replyToMessageId: opts.replyToMessageId,
        quoteText: opts.quoteText,
    });
    const hasThreadParams = Object.keys(threadParams).length > 0;
    const requestWithDiag = createTelegramNonIdempotentRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
    });
    const requestWithChatNotFound = createRequestWithChatNotFound({
        requestWithDiag,
        chatId,
        input: to,
    });
    const textMode = opts.textMode ?? "markdown";
    const tableMode = resolveMarkdownTableMode({
        cfg,
        channel: "telegram",
        accountId: account.accountId,
    });
    const renderHtmlText = (value) => renderTelegramHtmlText(value, { textMode, tableMode });
    // Resolve link preview setting from config (default: enabled).
    const linkPreviewEnabled = account.config.linkPreview ?? true;
    const linkPreviewOptions = linkPreviewEnabled ? undefined : { is_disabled: true };
    const sendTelegramTextChunk = async (chunk, params) => {
        return await withTelegramThreadFallback(params, "message", opts.verbose, async (effectiveParams, label) => {
            const baseParams = effectiveParams ? { ...effectiveParams } : {};
            if (linkPreviewOptions) {
                baseParams.link_preview_options = linkPreviewOptions;
            }
            const plainParams = {
                ...baseParams,
                ...(opts.silent === true ? { disable_notification: true } : {}),
            };
            const hasPlainParams = Object.keys(plainParams).length > 0;
            const requestPlain = (retryLabel) => requestWithChatNotFound(() => hasPlainParams
                ? api.sendMessage(chatId, chunk.plainText, plainParams)
                : api.sendMessage(chatId, chunk.plainText), retryLabel);
            if (!chunk.htmlText) {
                return await requestPlain(label);
            }
            const htmlText = chunk.htmlText;
            const htmlParams = {
                parse_mode: "HTML",
                ...plainParams,
            };
            return await withTelegramHtmlParseFallback({
                label,
                verbose: opts.verbose,
                requestHtml: (retryLabel) => requestWithChatNotFound(() => api.sendMessage(chatId, htmlText, htmlParams), retryLabel),
                requestPlain,
            });
        });
    };
    const buildTextParams = (isLastChunk) => hasThreadParams || (isLastChunk && replyMarkup)
        ? {
            ...threadParams,
            ...(isLastChunk && replyMarkup ? { reply_markup: replyMarkup } : {}),
        }
        : undefined;
    const sendTelegramTextChunks = async (chunks, context) => {
        let lastMessageId = "";
        let lastChatId = chatId;
        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            if (!chunk) {
                continue;
            }
            const res = await sendTelegramTextChunk(chunk, buildTextParams(index === chunks.length - 1));
            const messageId = resolveTelegramMessageIdOrThrow(res, context);
            recordSentMessage(chatId, messageId);
            lastMessageId = String(messageId);
            lastChatId = String(res?.chat?.id ?? chatId);
        }
        return { messageId: lastMessageId, chatId: lastChatId };
    };
    const buildChunkedTextPlan = (rawText, context) => {
        const fallbackText = opts.plainText ?? rawText;
        let htmlChunks;
        try {
            htmlChunks = splitTelegramHtmlChunks(rawText, 4000);
        }
        catch (error) {
            logVerbose(`telegram ${context} failed HTML chunk planning, retrying as plain text: ${formatErrorMessage(error)}`);
            return splitTelegramPlainTextChunks(fallbackText, 4000).map((plainText) => ({ plainText }));
        }
        const fixedPlainTextChunks = splitTelegramPlainTextChunks(fallbackText, 4000);
        if (fixedPlainTextChunks.length > htmlChunks.length) {
            logVerbose(`telegram ${context} plain-text fallback needs more chunks than HTML; sending plain text`);
            return fixedPlainTextChunks.map((plainText) => ({ plainText }));
        }
        const plainTextChunks = splitTelegramPlainTextFallback(fallbackText, htmlChunks.length, 4000);
        return htmlChunks.map((htmlText, index) => ({
            htmlText,
            plainText: plainTextChunks[index] ?? htmlText,
        }));
    };
    const sendChunkedText = async (rawText, context) => await sendTelegramTextChunks(buildChunkedTextPlan(rawText, context), context);
    async function shouldSendTelegramImageAsPhoto(buffer) {
        try {
            const metadata = await getImageMetadata(buffer);
            const width = metadata?.width;
            const height = metadata?.height;
            if (typeof width !== "number" || typeof height !== "number") {
                sendLogger.warn("Photo dimensions are unavailable. Sending as document instead.");
                return false;
            }
            const shorterSide = Math.min(width, height);
            const longerSide = Math.max(width, height);
            const isValidPhoto = width + height <= MAX_TELEGRAM_PHOTO_DIMENSION_SUM &&
                shorterSide > 0 &&
                longerSide <= shorterSide * MAX_TELEGRAM_PHOTO_ASPECT_RATIO;
            if (!isValidPhoto) {
                sendLogger.warn(`Photo dimensions (${width}x${height}) are not valid for Telegram photos. Sending as document instead.`);
                return false;
            }
            return true;
        }
        catch (err) {
            sendLogger.warn(`Failed to validate photo dimensions: ${formatErrorMessage(err)}. Sending as document instead.`);
            return false;
        }
    }
    if (mediaUrl) {
        const media = await loadWebMedia(mediaUrl, buildOutboundMediaLoadOptions({
            maxBytes: mediaMaxBytes,
            mediaLocalRoots: opts.mediaLocalRoots,
            optimizeImages: opts.forceDocument ? false : undefined,
        }));
        const kind = kindFromMime(media.contentType ?? undefined);
        const isGif = isGifMedia({
            contentType: media.contentType,
            fileName: media.fileName,
        });
        // Validate photo dimensions before attempting sendPhoto
        let sendImageAsPhoto = true;
        if (kind === "image" && !isGif && !opts.forceDocument) {
            sendImageAsPhoto = await shouldSendTelegramImageAsPhoto(media.buffer);
        }
        const isVideoNote = kind === "video" && opts.asVideoNote === true;
        const fileName = media.fileName ?? (isGif ? "animation.gif" : inferFilename(kind ?? "document")) ?? "file";
        const file = new InputFileCtor(media.buffer, fileName);
        let caption;
        let followUpText;
        if (isVideoNote) {
            caption = undefined;
            followUpText = text.trim() ? text : undefined;
        }
        else {
            const split = splitTelegramCaption(text);
            caption = split.caption;
            followUpText = split.followUpText;
        }
        const htmlCaption = caption ? renderHtmlText(caption) : undefined;
        // If text exceeds Telegram's caption limit, send media without caption
        // then send text as a separate follow-up message.
        const needsSeparateText = Boolean(followUpText);
        // When splitting, put reply_markup only on the follow-up text (the "main" content),
        // not on the media message.
        const baseMediaParams = {
            ...(hasThreadParams ? threadParams : {}),
            ...(!needsSeparateText && replyMarkup ? { reply_markup: replyMarkup } : {}),
        };
        const mediaParams = {
            ...(htmlCaption ? { caption: htmlCaption, parse_mode: "HTML" } : {}),
            ...baseMediaParams,
            ...(opts.silent === true ? { disable_notification: true } : {}),
        };
        const sendMedia = async (label, sender) => await withTelegramThreadFallback(mediaParams, label, opts.verbose, async (effectiveParams, retryLabel) => requestWithChatNotFound(() => sender(effectiveParams), retryLabel));
        const mediaSender = (() => {
            if (isGif && !opts.forceDocument) {
                return {
                    label: "animation",
                    sender: (effectiveParams) => api.sendAnimation(chatId, file, effectiveParams),
                };
            }
            if (kind === "image" && !opts.forceDocument && sendImageAsPhoto) {
                return {
                    label: "photo",
                    sender: (effectiveParams) => api.sendPhoto(chatId, file, effectiveParams),
                };
            }
            if (kind === "video") {
                if (isVideoNote) {
                    return {
                        label: "video_note",
                        sender: (effectiveParams) => api.sendVideoNote(chatId, file, effectiveParams),
                    };
                }
                return {
                    label: "video",
                    sender: (effectiveParams) => api.sendVideo(chatId, file, effectiveParams),
                };
            }
            if (kind === "audio") {
                const { useVoice } = resolveTelegramVoiceSend({
                    wantsVoice: opts.asVoice === true, // default false (backward compatible)
                    contentType: media.contentType,
                    fileName,
                    logFallback: logVerbose,
                });
                if (useVoice) {
                    return {
                        label: "voice",
                        sender: (effectiveParams) => api.sendVoice(chatId, file, effectiveParams),
                    };
                }
                return {
                    label: "audio",
                    sender: (effectiveParams) => api.sendAudio(chatId, file, effectiveParams),
                };
            }
            return {
                label: "document",
                sender: (effectiveParams) => api.sendDocument(chatId, file, 
                // Only force Telegram to keep the uploaded media type when callers explicitly
                // opt into document delivery for image/GIF uploads.
                (opts.forceDocument
                    ? { ...effectiveParams, disable_content_type_detection: true }
                    : effectiveParams)),
            };
        })();
        const result = await sendMedia(mediaSender.label, mediaSender.sender);
        const mediaMessageId = resolveTelegramMessageIdOrThrow(result, "media send");
        const resolvedChatId = String(result?.chat?.id ?? chatId);
        recordSentMessage(chatId, mediaMessageId);
        recordChannelActivity({
            channel: "telegram",
            accountId: account.accountId,
            direction: "outbound",
        });
        // If text was too long for a caption, send it as a separate follow-up message.
        // Use HTML conversion so markdown renders like captions.
        if (needsSeparateText && followUpText) {
            if (textMode === "html") {
                const textResult = await sendChunkedText(followUpText, "text follow-up send");
                return { messageId: textResult.messageId, chatId: resolvedChatId };
            }
            const textResult = await sendTelegramTextChunks([{ plainText: followUpText, htmlText: renderHtmlText(followUpText) }], "text follow-up send");
            return { messageId: textResult.messageId, chatId: resolvedChatId };
        }
        return { messageId: String(mediaMessageId), chatId: resolvedChatId };
    }
    if (!text || !text.trim()) {
        throw new Error("Message must be non-empty for Telegram sends");
    }
    let textResult;
    if (textMode === "html") {
        textResult = await sendChunkedText(text, "text send");
    }
    else {
        textResult = await sendTelegramTextChunks([{ plainText: opts.plainText ?? text, htmlText: renderHtmlText(text) }], "text send");
    }
    recordChannelActivity({
        channel: "telegram",
        accountId: account.accountId,
        direction: "outbound",
    });
    return textResult;
}
export async function sendTypingTelegram(to, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const target = parseTelegramTarget(to);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: target.chatId,
        persistTarget: to,
        verbose: opts.verbose,
    });
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
        shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
    });
    const threadParams = buildTypingThreadParams(target.messageThreadId ?? opts.messageThreadId);
    await requestWithDiag(() => api.sendChatAction(chatId, "typing", threadParams), "typing");
    return { ok: true };
}
export async function reactMessageTelegram(chatIdInput, messageIdInput, emoji, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const rawTarget = String(chatIdInput);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: rawTarget,
        persistTarget: rawTarget,
        verbose: opts.verbose,
    });
    const messageId = normalizeMessageId(messageIdInput);
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
        shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
    });
    const remove = opts.remove === true;
    const trimmedEmoji = emoji.trim();
    // Build the reaction array. We cast emoji to the grammY union type since
    // Telegram validates emoji server-side; invalid emojis fail gracefully.
    const reactions = remove || !trimmedEmoji
        ? []
        : [{ type: "emoji", emoji: trimmedEmoji }];
    if (typeof api.setMessageReaction !== "function") {
        throw new Error("Telegram reactions are unavailable in this bot API.");
    }
    try {
        await requestWithDiag(() => api.setMessageReaction(chatId, messageId, reactions), "reaction");
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/REACTION_INVALID/i.test(msg)) {
            return { ok: false, warning: `Reaction unavailable: ${trimmedEmoji}` };
        }
        throw err;
    }
    return { ok: true };
}
export async function deleteMessageTelegram(chatIdInput, messageIdInput, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const rawTarget = String(chatIdInput);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: rawTarget,
        persistTarget: rawTarget,
        verbose: opts.verbose,
    });
    const messageId = normalizeMessageId(messageIdInput);
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
        shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { context: "send" }),
    });
    await requestWithDiag(() => api.deleteMessage(chatId, messageId), "deleteMessage");
    logVerbose(`[telegram] Deleted message ${messageId} from chat ${chatId}`);
    return { ok: true };
}
export async function pinMessageTelegram(chatIdInput, messageIdInput, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const rawTarget = String(chatIdInput);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: rawTarget,
        persistTarget: rawTarget,
        verbose: opts.verbose,
    });
    const messageId = normalizeMessageId(messageIdInput);
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
    });
    await requestWithDiag(() => api.pinChatMessage(chatId, messageId, { disable_notification: true }), "pinChatMessage");
    logVerbose(`[telegram] Pinned message ${messageId} in chat ${chatId}`);
    return { ok: true, messageId: String(messageId), chatId };
}
export async function unpinMessageTelegram(chatIdInput, messageIdInput, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const rawTarget = String(chatIdInput);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: rawTarget,
        persistTarget: rawTarget,
        verbose: opts.verbose,
    });
    const messageId = messageIdInput === undefined ? undefined : normalizeMessageId(messageIdInput);
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
    });
    await requestWithDiag(() => api.unpinChatMessage(chatId, messageId), "unpinChatMessage");
    logVerbose(`[telegram] Unpinned ${messageId != null ? `message ${messageId}` : "active message"} in chat ${chatId}`);
    return {
        ok: true,
        chatId,
        ...(messageId != null ? { messageId: String(messageId) } : {}),
    };
}
export async function editForumTopicTelegram(chatIdInput, messageThreadIdInput, opts = {}) {
    const nameProvided = opts.name !== undefined;
    const trimmedName = opts.name?.trim();
    if (nameProvided && !trimmedName) {
        throw new Error("Telegram forum topic name is required");
    }
    if (trimmedName && trimmedName.length > 128) {
        throw new Error("Telegram forum topic name must be 128 characters or fewer");
    }
    const iconProvided = opts.iconCustomEmojiId !== undefined;
    const trimmedIconCustomEmojiId = opts.iconCustomEmojiId?.trim();
    if (iconProvided && !trimmedIconCustomEmojiId) {
        throw new Error("Telegram forum topic icon custom emoji ID is required");
    }
    if (!trimmedName && !trimmedIconCustomEmojiId) {
        throw new Error("Telegram forum topic update requires a name or iconCustomEmojiId");
    }
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const rawTarget = String(chatIdInput);
    const target = parseTelegramTarget(rawTarget);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: target.chatId,
        persistTarget: rawTarget,
        verbose: opts.verbose,
    });
    const messageThreadId = normalizeMessageId(messageThreadIdInput);
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
    });
    const payload = {
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(trimmedIconCustomEmojiId ? { icon_custom_emoji_id: trimmedIconCustomEmojiId } : {}),
    };
    await requestWithDiag(() => api.editForumTopic(chatId, messageThreadId, payload), "editForumTopic");
    logVerbose(`[telegram] Edited forum topic ${messageThreadId} in chat ${chatId}`);
    return {
        ok: true,
        chatId,
        messageThreadId,
        ...(trimmedName ? { name: trimmedName } : {}),
        ...(trimmedIconCustomEmojiId ? { iconCustomEmojiId: trimmedIconCustomEmojiId } : {}),
    };
}
export async function renameForumTopicTelegram(chatIdInput, messageThreadIdInput, name, opts = {}) {
    const result = await editForumTopicTelegram(chatIdInput, messageThreadIdInput, {
        ...opts,
        name,
    });
    return {
        ok: true,
        chatId: result.chatId,
        messageThreadId: result.messageThreadId,
        name: result.name ?? name.trim(),
    };
}
export async function editMessageReplyMarkupTelegram(chatIdInput, messageIdInput, buttons, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext({
        ...opts,
        cfg: opts.cfg,
    });
    const rawTarget = String(chatIdInput);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: rawTarget,
        persistTarget: rawTarget,
        verbose: opts.verbose,
    });
    const messageId = normalizeMessageId(messageIdInput);
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
    });
    const replyMarkup = buildInlineKeyboard(buttons) ?? { inline_keyboard: [] };
    try {
        await requestWithDiag(() => api.editMessageReplyMarkup(chatId, messageId, { reply_markup: replyMarkup }), "editMessageReplyMarkup", {
            shouldLog: (err) => !isTelegramMessageNotModifiedError(err),
        });
    }
    catch (err) {
        if (!isTelegramMessageNotModifiedError(err)) {
            throw err;
        }
    }
    logVerbose(`[telegram] Edited reply markup for message ${messageId} in chat ${chatId}`);
    return { ok: true, messageId: String(messageId), chatId };
}
export async function editMessageTelegram(chatIdInput, messageIdInput, text, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext({
        ...opts,
        cfg: opts.cfg,
    });
    const rawTarget = String(chatIdInput);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: rawTarget,
        persistTarget: rawTarget,
        verbose: opts.verbose,
    });
    const messageId = normalizeMessageId(messageIdInput);
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
        shouldRetry: (err) => isRecoverableTelegramNetworkError(err, { allowMessageMatch: true }) ||
            isTelegramServerError(err),
    });
    const requestWithEditShouldLog = (fn, label, shouldLog) => requestWithDiag(fn, label, shouldLog ? { shouldLog } : undefined);
    const textMode = opts.textMode ?? "markdown";
    const tableMode = resolveMarkdownTableMode({
        cfg,
        channel: "telegram",
        accountId: account.accountId,
    });
    const htmlText = renderTelegramHtmlText(text, { textMode, tableMode });
    // Reply markup semantics:
    // - buttons === undefined → don't send reply_markup (keep existing)
    // - buttons is [] (or filters to empty) → send { inline_keyboard: [] } (remove)
    // - otherwise → send built inline keyboard
    const shouldTouchButtons = opts.buttons !== undefined;
    const builtKeyboard = shouldTouchButtons ? buildInlineKeyboard(opts.buttons) : undefined;
    const replyMarkup = shouldTouchButtons ? (builtKeyboard ?? { inline_keyboard: [] }) : undefined;
    const editParams = {
        parse_mode: "HTML",
    };
    if (opts.linkPreview === false) {
        editParams.link_preview_options = { is_disabled: true };
    }
    if (replyMarkup !== undefined) {
        editParams.reply_markup = replyMarkup;
    }
    const plainParams = {};
    if (opts.linkPreview === false) {
        plainParams.link_preview_options = { is_disabled: true };
    }
    if (replyMarkup !== undefined) {
        plainParams.reply_markup = replyMarkup;
    }
    try {
        await withTelegramHtmlParseFallback({
            label: "editMessage",
            verbose: opts.verbose,
            requestHtml: (retryLabel) => requestWithEditShouldLog(() => api.editMessageText(chatId, messageId, htmlText, editParams), retryLabel, (err) => !isTelegramMessageNotModifiedError(err)),
            requestPlain: (retryLabel) => requestWithEditShouldLog(() => Object.keys(plainParams).length > 0
                ? api.editMessageText(chatId, messageId, text, plainParams)
                : api.editMessageText(chatId, messageId, text), retryLabel, (plainErr) => !isTelegramMessageNotModifiedError(plainErr)),
        });
    }
    catch (err) {
        if (isTelegramMessageNotModifiedError(err)) {
            // no-op: Telegram reports message content unchanged, treat as success
        }
        else {
            throw err;
        }
    }
    logVerbose(`[telegram] Edited message ${messageId} in chat ${chatId}`);
    return { ok: true, messageId: String(messageId), chatId };
}
function inferFilename(kind) {
    switch (kind) {
        case "image":
            return "image.jpg";
        case "video":
            return "video.mp4";
        case "audio":
            return "audio.ogg";
        default:
            return "file.bin";
    }
}
/**
 * Send a sticker to a Telegram chat by file_id.
 * @param to - Chat ID or username (e.g., "123456789" or "@username")
 * @param fileId - Telegram file_id of the sticker to send
 * @param opts - Optional configuration
 */
export async function sendStickerTelegram(to, fileId, opts = {}) {
    if (!fileId?.trim()) {
        throw new Error("Telegram sticker file_id is required");
    }
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const target = parseTelegramTarget(to);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: target.chatId,
        persistTarget: to,
        verbose: opts.verbose,
    });
    const threadParams = buildTelegramThreadReplyParams({
        targetMessageThreadId: target.messageThreadId,
        messageThreadId: opts.messageThreadId,
        chatType: target.chatType,
        replyToMessageId: opts.replyToMessageId,
    });
    const hasThreadParams = Object.keys(threadParams).length > 0;
    const requestWithDiag = createTelegramRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
        useApiErrorLogging: false,
    });
    const requestWithChatNotFound = createRequestWithChatNotFound({
        requestWithDiag,
        chatId,
        input: to,
    });
    const stickerParams = hasThreadParams ? threadParams : undefined;
    const result = await withTelegramThreadFallback(stickerParams, "sticker", opts.verbose, async (effectiveParams, label) => requestWithChatNotFound(() => api.sendSticker(chatId, fileId.trim(), effectiveParams), label));
    const messageId = resolveTelegramMessageIdOrThrow(result, "sticker send");
    const resolvedChatId = String(result?.chat?.id ?? chatId);
    recordSentMessage(chatId, messageId);
    recordChannelActivity({
        channel: "telegram",
        accountId: account.accountId,
        direction: "outbound",
    });
    return { messageId: String(messageId), chatId: resolvedChatId };
}
/**
 * Send a poll to a Telegram chat.
 * @param to - Chat ID or username (e.g., "123456789" or "@username")
 * @param poll - Poll input with question, options, maxSelections, and optional durationHours
 * @param opts - Optional configuration
 */
export async function sendPollTelegram(to, poll, opts = {}) {
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    const target = parseTelegramTarget(to);
    const chatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: target.chatId,
        persistTarget: to,
        verbose: opts.verbose,
        gatewayClientScopes: opts.gatewayClientScopes,
    });
    // Normalize the poll input (validates question, options, maxSelections)
    const normalizedPoll = normalizePollInput(poll, { maxOptions: 10 });
    const threadParams = buildTelegramThreadReplyParams({
        targetMessageThreadId: target.messageThreadId,
        messageThreadId: opts.messageThreadId,
        chatType: target.chatType,
        replyToMessageId: opts.replyToMessageId,
    });
    // Build poll options as simple strings (Grammy accepts string[] or InputPollOption[])
    const pollOptions = normalizedPoll.options;
    const requestWithDiag = createTelegramNonIdempotentRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
    });
    const requestWithChatNotFound = createRequestWithChatNotFound({
        requestWithDiag,
        chatId,
        input: to,
    });
    const durationSeconds = normalizedPoll.durationSeconds;
    if (durationSeconds === undefined && normalizedPoll.durationHours !== undefined) {
        throw new Error("Telegram poll durationHours is not supported. Use durationSeconds (5-600) instead.");
    }
    if (durationSeconds !== undefined && (durationSeconds < 5 || durationSeconds > 600)) {
        throw new Error("Telegram poll durationSeconds must be between 5 and 600");
    }
    // Build poll parameters following Grammy's api.sendPoll signature
    // sendPoll(chat_id, question, options, other?, signal?)
    const pollParams = {
        allows_multiple_answers: normalizedPoll.maxSelections > 1,
        is_anonymous: opts.isAnonymous ?? true,
        ...(durationSeconds !== undefined ? { open_period: durationSeconds } : {}),
        ...(Object.keys(threadParams).length > 0 ? threadParams : {}),
        ...(opts.silent === true ? { disable_notification: true } : {}),
    };
    const result = await withTelegramThreadFallback(pollParams, "poll", opts.verbose, async (effectiveParams, label) => requestWithChatNotFound(() => api.sendPoll(chatId, normalizedPoll.question, pollOptions, effectiveParams), label));
    const messageId = resolveTelegramMessageIdOrThrow(result, "poll send");
    const resolvedChatId = String(result?.chat?.id ?? chatId);
    const pollId = result?.poll?.id;
    recordSentMessage(chatId, messageId);
    recordChannelActivity({
        channel: "telegram",
        accountId: account.accountId,
        direction: "outbound",
    });
    return { messageId: String(messageId), chatId: resolvedChatId, pollId };
}
/**
 * Create a forum topic in a Telegram supergroup.
 * Requires the bot to have `can_manage_topics` permission.
 *
 * @param chatId - Supergroup chat ID
 * @param name - Topic name (1-128 characters)
 * @param opts - Optional configuration
 */
export async function createForumTopicTelegram(chatId, name, opts = {}) {
    if (!name?.trim()) {
        throw new Error("Forum topic name is required");
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 128) {
        throw new Error("Forum topic name must be 128 characters or fewer");
    }
    const { cfg, account, api } = resolveTelegramApiContext(opts);
    // Accept topic-qualified targets (e.g. telegram:group:<id>:topic:<thread>)
    // but createForumTopic must always target the base supergroup chat id.
    const target = parseTelegramTarget(chatId);
    const normalizedChatId = await resolveAndPersistChatId({
        cfg,
        api,
        lookupTarget: target.chatId,
        persistTarget: chatId,
        verbose: opts.verbose,
    });
    const requestWithDiag = createTelegramNonIdempotentRequestWithDiag({
        cfg,
        account,
        retry: opts.retry,
        verbose: opts.verbose,
    });
    const extra = {};
    if (opts.iconColor != null) {
        extra.icon_color = opts.iconColor;
    }
    if (opts.iconCustomEmojiId?.trim()) {
        extra.icon_custom_emoji_id = opts.iconCustomEmojiId.trim();
    }
    const hasExtra = Object.keys(extra).length > 0;
    const result = await requestWithDiag(() => api.createForumTopic(normalizedChatId, trimmedName, hasExtra ? extra : undefined), "createForumTopic");
    const topicId = result.message_thread_id;
    recordChannelActivity({
        channel: "telegram",
        accountId: account.accountId,
        direction: "outbound",
    });
    return {
        topicId,
        name: result.name ?? trimmedName,
        chatId: normalizedChatId,
    };
}
