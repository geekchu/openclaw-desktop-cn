// Lightweight in-memory queue for human-readable system events that should be
// prefixed to the next prompt. We intentionally avoid persistence to keep
// events ephemeral. Events are session-scoped and require an explicit key.
import { resolveGlobalMap } from "../shared/global-singleton.js";
import { mergeDeliveryContext, normalizeDeliveryContext, } from "../utils/delivery-context.js";
const MAX_EVENTS = 20;
const SYSTEM_EVENT_QUEUES_KEY = Symbol.for("openclaw.systemEvents.queues");
const queues = resolveGlobalMap(SYSTEM_EVENT_QUEUES_KEY);
function requireSessionKey(key) {
    const trimmed = typeof key === "string" ? key.trim() : "";
    if (!trimmed) {
        throw new Error("system events require a sessionKey");
    }
    return trimmed;
}
function normalizeContextKey(key) {
    if (!key) {
        return null;
    }
    const trimmed = key.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.toLowerCase();
}
function getSessionQueue(sessionKey) {
    return queues.get(requireSessionKey(sessionKey));
}
function getOrCreateSessionQueue(sessionKey) {
    const key = requireSessionKey(sessionKey);
    const existing = queues.get(key);
    if (existing) {
        return existing;
    }
    const created = {
        queue: [],
        lastText: null,
        lastContextKey: null,
    };
    queues.set(key, created);
    return created;
}
function cloneSystemEvent(event) {
    return {
        ...event,
        ...(event.deliveryContext ? { deliveryContext: { ...event.deliveryContext } } : {}),
    };
}
export function isSystemEventContextChanged(sessionKey, contextKey) {
    const existing = getSessionQueue(sessionKey);
    const normalized = normalizeContextKey(contextKey);
    return normalized !== (existing?.lastContextKey ?? null);
}
export function enqueueSystemEvent(text, options) {
    const key = requireSessionKey(options?.sessionKey);
    const entry = getOrCreateSessionQueue(key);
    const cleaned = text.trim();
    if (!cleaned) {
        return false;
    }
    const normalizedContextKey = normalizeContextKey(options?.contextKey);
    const normalizedDeliveryContext = normalizeDeliveryContext(options?.deliveryContext);
    entry.lastContextKey = normalizedContextKey;
    if (entry.lastText === cleaned) {
        return false;
    } // skip consecutive duplicates
    entry.lastText = cleaned;
    entry.queue.push({
        text: cleaned,
        ts: Date.now(),
        contextKey: normalizedContextKey,
        deliveryContext: normalizedDeliveryContext,
    });
    if (entry.queue.length > MAX_EVENTS) {
        entry.queue.shift();
    }
    return true;
}
export function drainSystemEventEntries(sessionKey) {
    const key = requireSessionKey(sessionKey);
    const entry = getSessionQueue(key);
    if (!entry || entry.queue.length === 0) {
        return [];
    }
    const out = entry.queue.map(cloneSystemEvent);
    entry.queue.length = 0;
    entry.lastText = null;
    entry.lastContextKey = null;
    queues.delete(key);
    return out;
}
export function drainSystemEvents(sessionKey) {
    return drainSystemEventEntries(sessionKey).map((event) => event.text);
}
export function peekSystemEventEntries(sessionKey) {
    return getSessionQueue(sessionKey)?.queue.map(cloneSystemEvent) ?? [];
}
export function peekSystemEvents(sessionKey) {
    return peekSystemEventEntries(sessionKey).map((event) => event.text);
}
export function hasSystemEvents(sessionKey) {
    return (getSessionQueue(sessionKey)?.queue.length ?? 0) > 0;
}
export function resolveSystemEventDeliveryContext(events) {
    let resolved;
    for (const event of events) {
        resolved = mergeDeliveryContext(event.deliveryContext, resolved);
    }
    return resolved;
}
export function resetSystemEventsForTest() {
    queues.clear();
}
