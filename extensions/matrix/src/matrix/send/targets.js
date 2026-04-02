import { inspectMatrixDirectRooms, persistMatrixDirectRoomMapping } from "../direct-management.js";
import { isStrictDirectRoom } from "../direct-room.js";
import { isMatrixQualifiedUserId, normalizeMatrixResolvableTarget } from "../target-ids.js";
function normalizeTarget(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("Matrix target is required (room:<id> or #alias)");
    }
    return trimmed;
}
export function normalizeThreadId(raw) {
    if (raw === undefined || raw === null) {
        return null;
    }
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : null;
}
// Size-capped to prevent unbounded growth (#4948)
const MAX_DIRECT_ROOM_CACHE_SIZE = 1024;
const directRoomCacheByClient = new WeakMap();
function resolveDirectRoomCache(client) {
    const existing = directRoomCacheByClient.get(client);
    if (existing) {
        return existing;
    }
    const created = new Map();
    directRoomCacheByClient.set(client, created);
    return created;
}
function setDirectRoomCached(client, key, value) {
    const directRoomCache = resolveDirectRoomCache(client);
    directRoomCache.set(key, value);
    if (directRoomCache.size > MAX_DIRECT_ROOM_CACHE_SIZE) {
        const oldest = directRoomCache.keys().next().value;
        if (oldest !== undefined) {
            directRoomCache.delete(oldest);
        }
    }
}
async function resolveDirectRoomId(client, userId) {
    const trimmed = userId.trim();
    if (!isMatrixQualifiedUserId(trimmed)) {
        throw new Error(`Matrix user IDs must be fully qualified (got "${trimmed}")`);
    }
    const selfUserId = (await client.getUserId().catch(() => null))?.trim() || null;
    const directRoomCache = resolveDirectRoomCache(client);
    const cached = directRoomCache.get(trimmed);
    if (cached &&
        (await isStrictDirectRoom({ client, roomId: cached, remoteUserId: trimmed, selfUserId }))) {
        return cached;
    }
    if (cached) {
        directRoomCache.delete(trimmed);
    }
    const inspection = await inspectMatrixDirectRooms({
        client,
        remoteUserId: trimmed,
    });
    if (inspection.activeRoomId) {
        setDirectRoomCached(client, trimmed, inspection.activeRoomId);
        if (inspection.mappedRoomIds[0] !== inspection.activeRoomId) {
            await persistMatrixDirectRoomMapping({
                client,
                remoteUserId: trimmed,
                roomId: inspection.activeRoomId,
            }).catch(() => {
                // Ignore persistence errors when send resolution has already found a usable room.
            });
        }
        return inspection.activeRoomId;
    }
    throw new Error(`No direct room found for ${trimmed} (m.direct missing)`);
}
export async function resolveMatrixRoomId(client, raw) {
    const target = normalizeMatrixResolvableTarget(normalizeTarget(raw));
    const lowered = target.toLowerCase();
    if (lowered.startsWith("user:")) {
        return await resolveDirectRoomId(client, target.slice("user:".length));
    }
    if (isMatrixQualifiedUserId(target)) {
        return await resolveDirectRoomId(client, target);
    }
    if (target.startsWith("#")) {
        const resolved = await client.resolveRoom(target);
        if (!resolved) {
            throw new Error(`Matrix alias ${target} could not be resolved`);
        }
        return resolved;
    }
    return target;
}
