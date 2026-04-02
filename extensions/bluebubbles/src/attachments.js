import crypto from "node:crypto";
import path from "node:path";
import { resolveBlueBubblesServerAccount } from "./account-resolve.js";
import { assertMultipartActionOk, postMultipartFormData } from "./multipart.js";
import { getCachedBlueBubblesPrivateApiStatus, isBlueBubblesPrivateApiStatusEnabled, } from "./probe.js";
import { resolveRequestUrl } from "./request-url.js";
import { getBlueBubblesRuntime, warnBlueBubbles } from "./runtime.js";
import { extractBlueBubblesMessageId, resolveBlueBubblesSendTarget } from "./send-helpers.js";
import { resolveChatGuidForTarget, createChatForHandle } from "./send.js";
import { blueBubblesFetchWithTimeout, buildBlueBubblesApiUrl, } from "./types.js";
function blueBubblesPolicy(allowPrivateNetwork) {
    return allowPrivateNetwork ? { allowPrivateNetwork: true } : {};
}
const DEFAULT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const AUDIO_MIME_MP3 = new Set(["audio/mpeg", "audio/mp3"]);
const AUDIO_MIME_CAF = new Set(["audio/x-caf", "audio/caf"]);
function sanitizeFilename(input, fallback) {
    const trimmed = input?.trim() ?? "";
    const base = trimmed ? path.basename(trimmed) : "";
    const name = base || fallback;
    // Strip characters that could enable multipart header injection (CWE-93)
    return name.replace(/[\r\n"\\]/g, "_");
}
function ensureExtension(filename, extension, fallbackBase) {
    const currentExt = path.extname(filename);
    if (currentExt.toLowerCase() === extension) {
        return filename;
    }
    const base = currentExt ? filename.slice(0, -currentExt.length) : filename;
    return `${base || fallbackBase}${extension}`;
}
function resolveVoiceInfo(filename, contentType) {
    const normalizedType = contentType?.trim().toLowerCase();
    const extension = path.extname(filename).toLowerCase();
    const isMp3 = extension === ".mp3" || (normalizedType ? AUDIO_MIME_MP3.has(normalizedType) : false);
    const isCaf = extension === ".caf" || (normalizedType ? AUDIO_MIME_CAF.has(normalizedType) : false);
    const isAudio = isMp3 || isCaf || Boolean(normalizedType?.startsWith("audio/"));
    return { isAudio, isMp3, isCaf };
}
function resolveAccount(params) {
    return resolveBlueBubblesServerAccount(params);
}
function safeExtractHostname(url) {
    try {
        const hostname = new URL(url).hostname.trim();
        return hostname || undefined;
    }
    catch {
        return undefined;
    }
}
function readMediaFetchErrorCode(error) {
    if (!error || typeof error !== "object") {
        return undefined;
    }
    const code = error.code;
    return code === "max_bytes" || code === "http_error" || code === "fetch_failed"
        ? code
        : undefined;
}
export async function downloadBlueBubblesAttachment(attachment, opts = {}) {
    const guid = attachment.guid?.trim();
    if (!guid) {
        throw new Error("BlueBubbles attachment guid is required");
    }
    const { baseUrl, password, allowPrivateNetwork } = resolveAccount(opts);
    const url = buildBlueBubblesApiUrl({
        baseUrl,
        path: `/api/v1/attachment/${encodeURIComponent(guid)}/download`,
        password,
    });
    const maxBytes = typeof opts.maxBytes === "number" ? opts.maxBytes : DEFAULT_ATTACHMENT_MAX_BYTES;
    const trustedHostname = safeExtractHostname(baseUrl);
    try {
        const fetched = await getBlueBubblesRuntime().channel.media.fetchRemoteMedia({
            url,
            filePathHint: attachment.transferName ?? attachment.guid ?? "attachment",
            maxBytes,
            ssrfPolicy: allowPrivateNetwork
                ? { allowPrivateNetwork: true }
                : trustedHostname
                    ? { allowedHostnames: [trustedHostname] }
                    : undefined,
            fetchImpl: async (input, init) => await blueBubblesFetchWithTimeout(resolveRequestUrl(input), { ...init, method: init?.method ?? "GET" }, opts.timeoutMs),
        });
        return {
            buffer: new Uint8Array(fetched.buffer),
            contentType: fetched.contentType ?? attachment.mimeType ?? undefined,
        };
    }
    catch (error) {
        if (readMediaFetchErrorCode(error) === "max_bytes") {
            throw new Error(`BlueBubbles attachment too large (limit ${maxBytes} bytes)`);
        }
        const text = error instanceof Error ? error.message : String(error);
        throw new Error(`BlueBubbles attachment download failed: ${text}`);
    }
}
/**
 * Send an attachment via BlueBubbles API.
 * Supports sending media files (images, videos, audio, documents) to a chat.
 * When asVoice is true, expects MP3/CAF audio and marks it as an iMessage voice memo.
 */
export async function sendBlueBubblesAttachment(params) {
    const { to, caption, replyToMessageGuid, replyToPartIndex, asVoice, opts = {} } = params;
    let { buffer, filename, contentType } = params;
    const wantsVoice = asVoice === true;
    const fallbackName = wantsVoice ? "Audio Message" : "attachment";
    filename = sanitizeFilename(filename, fallbackName);
    contentType = contentType?.trim() || undefined;
    const { baseUrl, password, accountId, allowPrivateNetwork } = resolveAccount(opts);
    const privateApiStatus = getCachedBlueBubblesPrivateApiStatus(accountId);
    const privateApiEnabled = isBlueBubblesPrivateApiStatusEnabled(privateApiStatus);
    // Validate voice memo format when requested (BlueBubbles converts MP3 -> CAF when isAudioMessage).
    const isAudioMessage = wantsVoice;
    if (isAudioMessage) {
        const voiceInfo = resolveVoiceInfo(filename, contentType);
        if (!voiceInfo.isAudio) {
            throw new Error("BlueBubbles voice messages require audio media (mp3 or caf).");
        }
        if (voiceInfo.isMp3) {
            filename = ensureExtension(filename, ".mp3", fallbackName);
            contentType = contentType ?? "audio/mpeg";
        }
        else if (voiceInfo.isCaf) {
            filename = ensureExtension(filename, ".caf", fallbackName);
            contentType = contentType ?? "audio/x-caf";
        }
        else {
            throw new Error("BlueBubbles voice messages require mp3 or caf audio (convert before sending).");
        }
    }
    const target = resolveBlueBubblesSendTarget(to);
    let chatGuid = await resolveChatGuidForTarget({
        baseUrl,
        password,
        timeoutMs: opts.timeoutMs,
        target,
        allowPrivateNetwork,
    });
    if (!chatGuid) {
        // For handle targets (phone numbers/emails), auto-create a new DM chat
        if (target.kind === "handle") {
            const created = await createChatForHandle({
                baseUrl,
                password,
                address: target.address,
                timeoutMs: opts.timeoutMs,
                allowPrivateNetwork,
            });
            chatGuid = created.chatGuid;
            // If we still don't have a chatGuid, try resolving again (chat was created server-side)
            if (!chatGuid) {
                chatGuid = await resolveChatGuidForTarget({
                    baseUrl,
                    password,
                    timeoutMs: opts.timeoutMs,
                    target,
                    allowPrivateNetwork,
                });
            }
        }
        if (!chatGuid) {
            throw new Error("BlueBubbles attachment send failed: chatGuid not found for target. Use a chat_guid target or ensure the chat exists.");
        }
    }
    const url = buildBlueBubblesApiUrl({
        baseUrl,
        path: "/api/v1/message/attachment",
        password,
    });
    // Build FormData with the attachment
    const boundary = `----BlueBubblesFormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
    const parts = [];
    const encoder = new TextEncoder();
    // Helper to add a form field
    const addField = (name, value) => {
        parts.push(encoder.encode(`--${boundary}\r\n`));
        parts.push(encoder.encode(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
        parts.push(encoder.encode(`${value}\r\n`));
    };
    // Helper to add a file field
    const addFile = (name, fileBuffer, fileName, mimeType) => {
        parts.push(encoder.encode(`--${boundary}\r\n`));
        parts.push(encoder.encode(`Content-Disposition: form-data; name="${name}"; filename="${fileName}"\r\n`));
        parts.push(encoder.encode(`Content-Type: ${mimeType ?? "application/octet-stream"}\r\n\r\n`));
        parts.push(fileBuffer);
        parts.push(encoder.encode("\r\n"));
    };
    // Add required fields
    addFile("attachment", buffer, filename, contentType);
    addField("chatGuid", chatGuid);
    addField("name", filename);
    addField("tempGuid", `temp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
    if (privateApiEnabled) {
        addField("method", "private-api");
    }
    // Add isAudioMessage flag for voice memos
    if (isAudioMessage) {
        addField("isAudioMessage", "true");
    }
    const trimmedReplyTo = replyToMessageGuid?.trim();
    if (trimmedReplyTo && privateApiEnabled) {
        addField("selectedMessageGuid", trimmedReplyTo);
        addField("partIndex", typeof replyToPartIndex === "number" ? String(replyToPartIndex) : "0");
    }
    else if (trimmedReplyTo && privateApiStatus === null) {
        warnBlueBubbles("Private API status unknown; sending attachment without reply threading metadata. Run a status probe to restore private-api reply features.");
    }
    // Add optional caption
    if (caption) {
        addField("message", caption);
        addField("text", caption);
        addField("caption", caption);
    }
    // Close the multipart body
    parts.push(encoder.encode(`--${boundary}--\r\n`));
    const res = await postMultipartFormData({
        url,
        boundary,
        parts,
        timeoutMs: opts.timeoutMs ?? 60_000, // longer timeout for file uploads
        ssrfPolicy: blueBubblesPolicy(allowPrivateNetwork),
    });
    await assertMultipartActionOk(res, "attachment send");
    const responseBody = await res.text();
    if (!responseBody) {
        return { messageId: "ok" };
    }
    try {
        const parsed = JSON.parse(responseBody);
        return { messageId: extractBlueBubblesMessageId(parsed) };
    }
    catch {
        return { messageId: "ok" };
    }
}
