import { createHash } from "node:crypto";
import { extractHandleFromChatGuid, normalizeBlueBubblesHandle } from "./targets.js";
const SELF_CHAT_TTL_MS = 10_000;
const MAX_SELF_CHAT_CACHE_ENTRIES = 512;
const CLEANUP_MIN_INTERVAL_MS = 1_000;
const MAX_SELF_CHAT_BODY_CHARS = 32_768;
const cache = new Map();
let lastCleanupAt = 0;
function normalizeBody(body) {
    if (!body) {
        return null;
    }
    const bounded = body.length > MAX_SELF_CHAT_BODY_CHARS ? body.slice(0, MAX_SELF_CHAT_BODY_CHARS) : body;
    const normalized = bounded.replace(/\r\n?/g, "\n").trim();
    return normalized ? normalized : null;
}
function isUsableTimestamp(timestamp) {
    return typeof timestamp === "number" && Number.isFinite(timestamp);
}
function digestText(text) {
    return createHash("sha256").update(text).digest("base64url");
}
function trimOrUndefined(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function resolveCanonicalChatTarget(parts) {
    const handleFromGuid = parts.chatGuid ? extractHandleFromChatGuid(parts.chatGuid) : null;
    if (handleFromGuid) {
        return handleFromGuid;
    }
    const normalizedIdentifier = normalizeBlueBubblesHandle(parts.chatIdentifier ?? "");
    if (normalizedIdentifier) {
        return normalizedIdentifier;
    }
    return (trimOrUndefined(parts.chatGuid) ??
        trimOrUndefined(parts.chatIdentifier) ??
        (typeof parts.chatId === "number" ? String(parts.chatId) : null));
}
function buildScope(parts) {
    const target = resolveCanonicalChatTarget(parts) ?? parts.senderId;
    return `${parts.accountId}:${target}`;
}
function cleanupExpired(now = Date.now()) {
    if (lastCleanupAt !== 0 &&
        now >= lastCleanupAt &&
        now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) {
        return;
    }
    lastCleanupAt = now;
    for (const [key, seenAt] of cache.entries()) {
        if (now - seenAt > SELF_CHAT_TTL_MS) {
            cache.delete(key);
        }
    }
}
function enforceSizeCap() {
    while (cache.size > MAX_SELF_CHAT_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (typeof oldestKey !== "string") {
            break;
        }
        cache.delete(oldestKey);
    }
}
function buildKey(lookup) {
    const body = normalizeBody(lookup.body);
    if (!body || !isUsableTimestamp(lookup.timestamp)) {
        return null;
    }
    return `${buildScope(lookup)}:${lookup.timestamp}:${digestText(body)}`;
}
export function rememberBlueBubblesSelfChatCopy(lookup) {
    cleanupExpired();
    const key = buildKey(lookup);
    if (!key) {
        return;
    }
    cache.set(key, Date.now());
    enforceSizeCap();
}
export function hasBlueBubblesSelfChatCopy(lookup) {
    cleanupExpired();
    const key = buildKey(lookup);
    if (!key) {
        return false;
    }
    const seenAt = cache.get(key);
    return typeof seenAt === "number" && Date.now() - seenAt <= SELF_CHAT_TTL_MS;
}
export function resetBlueBubblesSelfChatCache() {
    cache.clear();
    lastCleanupAt = 0;
}
