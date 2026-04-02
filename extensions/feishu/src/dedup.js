import os from "node:os";
import path from "node:path";
import { createDedupeCache, createPersistentDedupe, readJsonFileWithFallback, } from "../runtime-api.js";
// Persistent TTL: 24 hours — survives restarts & WebSocket reconnects.
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const MEMORY_MAX_SIZE = 1_000;
const FILE_MAX_ENTRIES = 10_000;
const EVENT_DEDUP_TTL_MS = 5 * 60 * 1000;
const EVENT_MEMORY_MAX_SIZE = 2_000;
const memoryDedupe = createDedupeCache({ ttlMs: DEDUP_TTL_MS, maxSize: MEMORY_MAX_SIZE });
const processingClaims = createDedupeCache({
    ttlMs: EVENT_DEDUP_TTL_MS,
    maxSize: EVENT_MEMORY_MAX_SIZE,
});
function resolveStateDirFromEnv(env = process.env) {
    const stateOverride = env.OPENCLAW_STATE_DIR?.trim();
    if (stateOverride) {
        return stateOverride;
    }
    if (env.VITEST || env.NODE_ENV === "test") {
        return path.join(os.tmpdir(), ["openclaw-vitest", String(process.pid)].join("-"));
    }
    return path.join(os.homedir(), ".openclawcn");
}
function resolveNamespaceFilePath(namespace) {
    const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(resolveStateDirFromEnv(), "feishu", "dedup", `${safe}.json`);
}
const persistentDedupe = createPersistentDedupe({
    ttlMs: DEDUP_TTL_MS,
    memoryMaxSize: MEMORY_MAX_SIZE,
    fileMaxEntries: FILE_MAX_ENTRIES,
    resolveFilePath: resolveNamespaceFilePath,
});
function resolveEventDedupeKey(namespace, messageId) {
    const trimmed = messageId?.trim();
    if (!trimmed) {
        return null;
    }
    return `${namespace}:${trimmed}`;
}
function normalizeMessageId(messageId) {
    const trimmed = messageId?.trim();
    return trimmed ? trimmed : null;
}
function resolveMemoryDedupeKey(namespace, messageId) {
    const trimmed = normalizeMessageId(messageId);
    if (!trimmed) {
        return null;
    }
    return `${namespace}:${trimmed}`;
}
export function tryBeginFeishuMessageProcessing(messageId, namespace = "global") {
    return !processingClaims.check(resolveEventDedupeKey(namespace, messageId));
}
export function releaseFeishuMessageProcessing(messageId, namespace = "global") {
    processingClaims.delete(resolveEventDedupeKey(namespace, messageId));
}
export async function finalizeFeishuMessageProcessing(params) {
    const { messageId, namespace = "global", log, claimHeld = false } = params;
    const normalizedMessageId = normalizeMessageId(messageId);
    const memoryKey = resolveMemoryDedupeKey(namespace, messageId);
    if (!memoryKey || !normalizedMessageId) {
        return false;
    }
    if (!claimHeld && !tryBeginFeishuMessageProcessing(normalizedMessageId, namespace)) {
        return false;
    }
    if (!tryRecordMessage(memoryKey)) {
        releaseFeishuMessageProcessing(normalizedMessageId, namespace);
        return false;
    }
    if (!(await tryRecordMessagePersistent(normalizedMessageId, namespace, log))) {
        releaseFeishuMessageProcessing(normalizedMessageId, namespace);
        return false;
    }
    return true;
}
export async function recordProcessedFeishuMessage(messageId, namespace = "global", log) {
    const normalizedMessageId = normalizeMessageId(messageId);
    const memoryKey = resolveMemoryDedupeKey(namespace, messageId);
    if (!memoryKey || !normalizedMessageId) {
        return false;
    }
    tryRecordMessage(memoryKey);
    return await tryRecordMessagePersistent(normalizedMessageId, namespace, log);
}
export async function hasProcessedFeishuMessage(messageId, namespace = "global", log) {
    const normalizedMessageId = normalizeMessageId(messageId);
    const memoryKey = resolveMemoryDedupeKey(namespace, messageId);
    if (!memoryKey || !normalizedMessageId) {
        return false;
    }
    if (hasRecordedMessage(memoryKey)) {
        return true;
    }
    return hasRecordedMessagePersistent(normalizedMessageId, namespace, log);
}
/**
 * Synchronous dedup — memory only.
 * Kept for backward compatibility; prefer {@link tryRecordMessagePersistent}.
 */
export function tryRecordMessage(messageId) {
    return !memoryDedupe.check(messageId);
}
export function hasRecordedMessage(messageId) {
    const trimmed = messageId.trim();
    if (!trimmed) {
        return false;
    }
    return memoryDedupe.peek(trimmed);
}
export async function tryRecordMessagePersistent(messageId, namespace = "global", log) {
    return persistentDedupe.checkAndRecord(messageId, {
        namespace,
        onDiskError: (error) => {
            log?.(`feishu-dedup: disk error, falling back to memory: ${String(error)}`);
        },
    });
}
export async function hasRecordedMessagePersistent(messageId, namespace = "global", log) {
    const trimmed = messageId.trim();
    if (!trimmed) {
        return false;
    }
    const now = Date.now();
    const filePath = resolveNamespaceFilePath(namespace);
    try {
        const { value } = await readJsonFileWithFallback(filePath, {});
        const seenAt = value[trimmed];
        if (typeof seenAt !== "number" || !Number.isFinite(seenAt)) {
            return false;
        }
        return DEDUP_TTL_MS <= 0 || now - seenAt < DEDUP_TTL_MS;
    }
    catch (error) {
        log?.(`feishu-dedup: persistent peek failed: ${String(error)}`);
        return false;
    }
}
export async function warmupDedupFromDisk(namespace, log) {
    return persistentDedupe.warmup(namespace, (error) => {
        log?.(`feishu-dedup: warmup disk error: ${String(error)}`);
    });
}
