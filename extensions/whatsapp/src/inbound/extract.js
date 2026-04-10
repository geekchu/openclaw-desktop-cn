import { extractMessageContent, getContentType, normalizeMessageContent, } from "@whiskeysockets/baileys";
import { formatLocationText } from "openclaw/plugin-sdk/channel-inbound";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { resolveComparableIdentity } from "../identity.js";
import { jidToE164 } from "../text-runtime.js";
import { parseVcard } from "../vcard.js";
const MESSAGE_WRAPPER_KEYS = [
    "botInvokeMessage",
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "groupMentionedMessage",
];
const MESSAGE_CONTENT_KEYS = [
    "conversation",
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage",
    "locationMessage",
    "liveLocationMessage",
    "contactMessage",
    "contactsArrayMessage",
    "buttonsResponseMessage",
    "listResponseMessage",
    "templateButtonReplyMessage",
    "interactiveResponseMessage",
    "buttonsMessage",
    "listMessage",
];
function fallbackNormalizeMessageContent(message) {
    let current = message;
    while (current && typeof current === "object") {
        let unwrapped = false;
        for (const key of MESSAGE_WRAPPER_KEYS) {
            const candidate = current[key];
            if (candidate &&
                typeof candidate === "object" &&
                "message" in candidate &&
                candidate.message) {
                current = candidate.message;
                unwrapped = true;
                break;
            }
        }
        if (!unwrapped) {
            break;
        }
    }
    return current;
}
function normalizeMessage(message) {
    if (typeof normalizeMessageContent === "function") {
        return normalizeMessageContent(message);
    }
    return fallbackNormalizeMessageContent(message);
}
function fallbackGetContentType(message) {
    const normalized = fallbackNormalizeMessageContent(message);
    if (!normalized || typeof normalized !== "object") {
        return undefined;
    }
    for (const key of MESSAGE_CONTENT_KEYS) {
        if (normalized[key] != null) {
            return key;
        }
    }
    return undefined;
}
function getMessageContentType(message) {
    if (typeof getContentType === "function") {
        return getContentType(message);
    }
    return fallbackGetContentType(message);
}
function extractMessage(message) {
    if (typeof extractMessageContent === "function") {
        return extractMessageContent(message);
    }
    const normalized = fallbackNormalizeMessageContent(message);
    const contentType = fallbackGetContentType(normalized);
    if (!normalized || !contentType || contentType === "conversation") {
        return normalized;
    }
    const candidate = normalized[contentType];
    return candidate && typeof candidate === "object" ? candidate : normalized;
}
function getFutureProofInnerMessage(message) {
    const contentType = getMessageContentType(message);
    const candidate = contentType ? message[contentType] : undefined;
    if (candidate &&
        typeof candidate === "object" &&
        "message" in candidate &&
        candidate.message &&
        typeof candidate.message === "object") {
        const inner = normalizeMessage(candidate.message);
        if (inner) {
            const innerType = getMessageContentType(inner);
            if (innerType && innerType !== contentType) {
                return inner;
            }
        }
    }
    return undefined;
}
function buildMessageChain(message) {
    const chain = [];
    let current = normalizeMessage(message);
    while (current && chain.length < 4) {
        chain.push(current);
        current = getFutureProofInnerMessage(current);
    }
    return chain;
}
function unwrapMessage(message) {
    const chain = buildMessageChain(message);
    return chain.at(-1);
}
function extractContextInfoFromMessage(message) {
    const contentType = getMessageContentType(message);
    const candidate = contentType ? message[contentType] : undefined;
    const contextInfo = candidate && typeof candidate === "object" && "contextInfo" in candidate
        ? candidate.contextInfo
        : undefined;
    if (contextInfo) {
        return contextInfo;
    }
    const fallback = message.extendedTextMessage?.contextInfo ??
        message.imageMessage?.contextInfo ??
        message.videoMessage?.contextInfo ??
        message.documentMessage?.contextInfo ??
        message.audioMessage?.contextInfo ??
        message.stickerMessage?.contextInfo ??
        message.buttonsResponseMessage?.contextInfo ??
        message.listResponseMessage?.contextInfo ??
        message.templateButtonReplyMessage?.contextInfo ??
        message.interactiveResponseMessage?.contextInfo ??
        message.buttonsMessage?.contextInfo ??
        message.listMessage?.contextInfo;
    if (fallback) {
        return fallback;
    }
    for (const value of Object.values(message)) {
        if (!value || typeof value !== "object") {
            continue;
        }
        if ("contextInfo" in value) {
            const candidateContext = value.contextInfo;
            if (candidateContext) {
                return candidateContext;
            }
        }
        // FutureProofMessage wrapper: dig into .message to find contextInfo
        if ("message" in value) {
            const inner = value.message;
            if (inner) {
                const innerCtx = extractContextInfo(inner);
                if (innerCtx) {
                    return innerCtx;
                }
            }
        }
    }
    return undefined;
}
function extractContextInfo(message) {
    for (const candidate of buildMessageChain(message)) {
        const contextInfo = extractContextInfoFromMessage(candidate);
        if (contextInfo) {
            return contextInfo;
        }
    }
    return undefined;
}
export function extractMentionedJids(rawMessage) {
    const message = unwrapMessage(rawMessage);
    if (!message) {
        return undefined;
    }
    const candidates = [
        message.extendedTextMessage?.contextInfo?.mentionedJid,
        message.imageMessage?.contextInfo?.mentionedJid,
        message.videoMessage?.contextInfo?.mentionedJid,
        message.documentMessage?.contextInfo?.mentionedJid,
        message.audioMessage?.contextInfo?.mentionedJid,
        message.stickerMessage?.contextInfo?.mentionedJid,
        message.buttonsResponseMessage?.contextInfo?.mentionedJid,
        message.listResponseMessage?.contextInfo?.mentionedJid,
    ];
    const flattened = candidates.flatMap((arr) => arr ?? []).filter(Boolean);
    if (flattened.length === 0) {
        return undefined;
    }
    return Array.from(new Set(flattened));
}
export function extractText(rawMessage) {
    const message = unwrapMessage(rawMessage);
    if (!message) {
        return undefined;
    }
    const extracted = extractMessage(message);
    const candidates = [message, extracted && extracted !== message ? extracted : undefined];
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        if (typeof candidate.conversation === "string" && candidate.conversation.trim()) {
            return candidate.conversation.trim();
        }
        const extended = candidate.extendedTextMessage?.text;
        if (extended?.trim()) {
            return extended.trim();
        }
        const caption = candidate.imageMessage?.caption ??
            candidate.videoMessage?.caption ??
            candidate.documentMessage?.caption;
        if (caption?.trim()) {
            return caption.trim();
        }
    }
    const contactPlaceholder = extractContactPlaceholder(message) ??
        (extracted && extracted !== message
            ? extractContactPlaceholder(extracted)
            : undefined);
    if (contactPlaceholder) {
        return contactPlaceholder;
    }
    return undefined;
}
export function extractMediaPlaceholder(rawMessage) {
    const message = unwrapMessage(rawMessage);
    if (!message) {
        return undefined;
    }
    if (message.imageMessage) {
        return "<media:image>";
    }
    if (message.videoMessage) {
        return "<media:video>";
    }
    if (message.audioMessage) {
        return "<media:audio>";
    }
    if (message.documentMessage) {
        return "<media:document>";
    }
    if (message.stickerMessage) {
        return "<media:sticker>";
    }
    return undefined;
}
function extractContactPlaceholder(rawMessage) {
    const message = unwrapMessage(rawMessage);
    if (!message) {
        return undefined;
    }
    const contact = message.contactMessage ?? undefined;
    if (contact) {
        const { name, phones } = describeContact({
            displayName: contact.displayName,
            vcard: contact.vcard,
        });
        return formatContactPlaceholder(name, phones);
    }
    const contactsArray = message.contactsArrayMessage?.contacts ?? undefined;
    if (!contactsArray || contactsArray.length === 0) {
        return undefined;
    }
    const labels = contactsArray
        .map((entry) => describeContact({ displayName: entry.displayName, vcard: entry.vcard }))
        .map((entry) => formatContactLabel(entry.name, entry.phones))
        .filter((value) => Boolean(value));
    return formatContactsPlaceholder(labels, contactsArray.length);
}
function describeContact(input) {
    const displayName = (input.displayName ?? "").trim();
    const parsed = parseVcard(input.vcard ?? undefined);
    const name = displayName || parsed.name;
    return { name, phones: parsed.phones };
}
function formatContactPlaceholder(name, phones) {
    const label = formatContactLabel(name, phones);
    if (!label) {
        return "<contact>";
    }
    return `<contact: ${label}>`;
}
function formatContactsPlaceholder(labels, total) {
    const cleaned = labels.map((label) => label.trim()).filter(Boolean);
    if (cleaned.length === 0) {
        const suffix = total === 1 ? "contact" : "contacts";
        return `<contacts: ${total} ${suffix}>`;
    }
    const remaining = Math.max(total - cleaned.length, 0);
    const suffix = remaining > 0 ? ` +${remaining} more` : "";
    return `<contacts: ${cleaned.join(", ")}${suffix}>`;
}
function formatContactLabel(name, phones) {
    const phoneLabel = formatPhoneList(phones);
    const parts = [name, phoneLabel].filter((value) => Boolean(value));
    if (parts.length === 0) {
        return undefined;
    }
    return parts.join(", ");
}
function formatPhoneList(phones) {
    const cleaned = phones?.map((phone) => phone.trim()).filter(Boolean) ?? [];
    if (cleaned.length === 0) {
        return undefined;
    }
    const { shown, remaining } = summarizeList(cleaned, cleaned.length, 1);
    const [primary] = shown;
    if (!primary) {
        return undefined;
    }
    if (remaining === 0) {
        return primary;
    }
    return `${primary} (+${remaining} more)`;
}
function summarizeList(values, total, maxShown) {
    const shown = values.slice(0, maxShown);
    const remaining = Math.max(total - shown.length, 0);
    return { shown, remaining };
}
export function extractLocationData(rawMessage) {
    const message = unwrapMessage(rawMessage);
    if (!message) {
        return null;
    }
    const live = message.liveLocationMessage ?? undefined;
    if (live) {
        const latitudeRaw = live.degreesLatitude;
        const longitudeRaw = live.degreesLongitude;
        if (latitudeRaw != null && longitudeRaw != null) {
            const latitude = Number(latitudeRaw);
            const longitude = Number(longitudeRaw);
            if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                return {
                    latitude,
                    longitude,
                    accuracy: live.accuracyInMeters ?? undefined,
                    caption: live.caption ?? undefined,
                    source: "live",
                    isLive: true,
                };
            }
        }
    }
    const location = message.locationMessage ?? undefined;
    if (location) {
        const latitudeRaw = location.degreesLatitude;
        const longitudeRaw = location.degreesLongitude;
        if (latitudeRaw != null && longitudeRaw != null) {
            const latitude = Number(latitudeRaw);
            const longitude = Number(longitudeRaw);
            if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                const isLive = Boolean(location.isLive);
                return {
                    latitude,
                    longitude,
                    accuracy: location.accuracyInMeters ?? undefined,
                    name: location.name ?? undefined,
                    address: location.address ?? undefined,
                    caption: location.comment ?? undefined,
                    source: isLive ? "live" : location.name || location.address ? "place" : "pin",
                    isLive,
                };
            }
        }
    }
    return null;
}
export function describeReplyContext(rawMessage) {
    const message = unwrapMessage(rawMessage);
    if (!message) {
        return null;
    }
    const contextInfo = extractContextInfo(message);
    const quoted = normalizeMessage(contextInfo?.quotedMessage);
    if (!quoted) {
        return null;
    }
    const location = extractLocationData(quoted);
    const locationText = location ? formatLocationText(location) : undefined;
    const text = extractText(quoted);
    let body = [text, locationText].filter(Boolean).join("\n").trim();
    if (!body) {
        body = extractMediaPlaceholder(quoted);
    }
    if (!body) {
        const quotedType = quoted ? getMessageContentType(quoted) : undefined;
        logVerbose(`Quoted message missing extractable body${quotedType ? ` (type ${quotedType})` : ""}`);
        return null;
    }
    const senderJid = contextInfo?.participant ?? undefined;
    const sender = resolveComparableIdentity({
        jid: senderJid,
        label: senderJid ? (jidToE164(senderJid) ?? senderJid) : "unknown sender",
    });
    return {
        id: contextInfo?.stanzaId ? String(contextInfo.stanzaId) : undefined,
        body,
        sender,
    };
}
