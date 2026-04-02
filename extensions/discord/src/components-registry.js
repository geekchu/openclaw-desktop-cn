import { resolveGlobalMap } from "openclaw/plugin-sdk/global-singleton";
const DEFAULT_COMPONENT_TTL_MS = 30 * 60 * 1000;
const DISCORD_COMPONENT_ENTRIES_KEY = Symbol.for("openclaw.discord.componentEntries");
const DISCORD_MODAL_ENTRIES_KEY = Symbol.for("openclaw.discord.modalEntries");
let componentEntries;
let modalEntries;
function getComponentEntries() {
    componentEntries ??= resolveGlobalMap(DISCORD_COMPONENT_ENTRIES_KEY);
    return componentEntries;
}
function getModalEntries() {
    modalEntries ??= resolveGlobalMap(DISCORD_MODAL_ENTRIES_KEY);
    return modalEntries;
}
function isExpired(entry, now) {
    return typeof entry.expiresAt === "number" && entry.expiresAt <= now;
}
function normalizeEntryTimestamps(entry, now, ttlMs) {
    const createdAt = entry.createdAt ?? now;
    const expiresAt = entry.expiresAt ?? createdAt + ttlMs;
    return { ...entry, createdAt, expiresAt };
}
function registerEntries(entries, store, params) {
    for (const entry of entries) {
        const normalized = normalizeEntryTimestamps({ ...entry, messageId: params.messageId ?? entry.messageId }, params.now, params.ttlMs);
        store.set(entry.id, normalized);
    }
}
function resolveEntry(store, params) {
    const entry = store.get(params.id);
    if (!entry) {
        return null;
    }
    const now = Date.now();
    if (isExpired(entry, now)) {
        store.delete(params.id);
        return null;
    }
    if (params.consume !== false) {
        store.delete(params.id);
    }
    return entry;
}
export function registerDiscordComponentEntries(params) {
    const now = Date.now();
    const ttlMs = params.ttlMs ?? DEFAULT_COMPONENT_TTL_MS;
    registerEntries(params.entries, getComponentEntries(), {
        now,
        ttlMs,
        messageId: params.messageId,
    });
    registerEntries(params.modals, getModalEntries(), { now, ttlMs, messageId: params.messageId });
}
export function resolveDiscordComponentEntry(params) {
    return resolveEntry(getComponentEntries(), params);
}
export function resolveDiscordModalEntry(params) {
    return resolveEntry(getModalEntries(), params);
}
export function clearDiscordComponentEntries() {
    getComponentEntries().clear();
    getModalEntries().clear();
}
