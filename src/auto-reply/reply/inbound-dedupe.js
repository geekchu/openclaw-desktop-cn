import { logVerbose, shouldLogVerbose } from "../../globals.js";
import { resolveGlobalDedupeCache } from "../../infra/dedupe.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
const DEFAULT_INBOUND_DEDUPE_TTL_MS = 20 * 60_000;
const DEFAULT_INBOUND_DEDUPE_MAX = 5000;
/**
 * Keep inbound dedupe shared across bundled chunks so the same provider
 * message cannot bypass dedupe by entering through a different chunk copy.
 */
const INBOUND_DEDUPE_CACHE_KEY = Symbol.for("openclaw.inboundDedupeCache");
const inboundDedupeCache = resolveGlobalDedupeCache(INBOUND_DEDUPE_CACHE_KEY, {
    ttlMs: DEFAULT_INBOUND_DEDUPE_TTL_MS,
    maxSize: DEFAULT_INBOUND_DEDUPE_MAX,
});
const normalizeProvider = (value) => value?.trim().toLowerCase() || "";
const resolveInboundPeerId = (ctx) => ctx.OriginatingTo ?? ctx.To ?? ctx.From ?? ctx.SessionKey;
function resolveInboundDedupeSessionScope(ctx) {
    const sessionKey = (ctx.CommandSource === "native" ? ctx.CommandTargetSessionKey : undefined)?.trim() ||
        ctx.SessionKey?.trim() ||
        "";
    if (!sessionKey) {
        return "";
    }
    const parsed = parseAgentSessionKey(sessionKey);
    if (!parsed) {
        return sessionKey;
    }
    // The same physical inbound message should never run twice for the same
    // agent, even if a routing bug presents it under both main and direct keys.
    return `agent:${parsed.agentId}`;
}
export function buildInboundDedupeKey(ctx) {
    const provider = normalizeProvider(ctx.OriginatingChannel ?? ctx.Provider ?? ctx.Surface);
    const messageId = ctx.MessageSid?.trim();
    if (!provider || !messageId) {
        return null;
    }
    const peerId = resolveInboundPeerId(ctx);
    if (!peerId) {
        return null;
    }
    const sessionScope = resolveInboundDedupeSessionScope(ctx);
    const accountId = ctx.AccountId?.trim() ?? "";
    const threadId = ctx.MessageThreadId !== undefined && ctx.MessageThreadId !== null
        ? String(ctx.MessageThreadId)
        : "";
    return [provider, accountId, sessionScope, peerId, threadId, messageId].filter(Boolean).join("|");
}
export function shouldSkipDuplicateInbound(ctx, opts) {
    const key = buildInboundDedupeKey(ctx);
    if (!key) {
        return false;
    }
    const cache = opts?.cache ?? inboundDedupeCache;
    const skipped = cache.check(key, opts?.now);
    if (skipped && shouldLogVerbose()) {
        logVerbose(`inbound dedupe: skipped ${key}`);
    }
    return skipped;
}
export function resetInboundDedupe() {
    inboundDedupeCache.clear();
}
