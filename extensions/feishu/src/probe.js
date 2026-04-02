import { raceWithTimeoutAndAbort } from "./async.js";
import { createFeishuClient } from "./client.js";
/** Cache probe results to reduce repeated health-check calls.
 * Gateway health checks call probeFeishu() every minute; without caching this
 * burns ~43,200 calls/month, easily exceeding Feishu's free-tier quota.
 * Successful bot info is effectively static, while failures are cached briefly
 * to avoid hammering the API during transient outages. */
const probeCache = new Map();
const PROBE_SUCCESS_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PROBE_ERROR_TTL_MS = 60 * 1000; // 1 minute
const MAX_PROBE_CACHE_SIZE = 64;
export const FEISHU_PROBE_REQUEST_TIMEOUT_MS = 10_000;
function setCachedProbeResult(cacheKey, result, ttlMs) {
    probeCache.set(cacheKey, { result, expiresAt: Date.now() + ttlMs });
    if (probeCache.size > MAX_PROBE_CACHE_SIZE) {
        const oldest = probeCache.keys().next().value;
        if (oldest !== undefined) {
            probeCache.delete(oldest);
        }
    }
    return result;
}
export async function probeFeishu(creds, options = {}) {
    if (!creds?.appId || !creds?.appSecret) {
        return {
            ok: false,
            error: "missing credentials (appId, appSecret)",
        };
    }
    if (options.abortSignal?.aborted) {
        return {
            ok: false,
            appId: creds.appId,
            error: "probe aborted",
        };
    }
    const timeoutMs = options.timeoutMs ?? FEISHU_PROBE_REQUEST_TIMEOUT_MS;
    // Return cached result if still valid.
    // Use accountId when available; otherwise include appSecret prefix so two
    // accounts sharing the same appId (e.g. after secret rotation) don't
    // pollute each other's cache entry.
    const cacheKey = creds.accountId ?? `${creds.appId}:${creds.appSecret.slice(0, 8)}`;
    const cached = probeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }
    try {
        const client = createFeishuClient(creds);
        // Use bot/v3/info API to get bot information
        const responseResult = await raceWithTimeoutAndAbort(client.request({
            method: "GET",
            url: "/open-apis/bot/v3/info",
            data: {},
            timeout: timeoutMs,
        }), {
            timeoutMs,
            abortSignal: options.abortSignal,
        });
        if (responseResult.status === "aborted") {
            return {
                ok: false,
                appId: creds.appId,
                error: "probe aborted",
            };
        }
        if (responseResult.status === "timeout") {
            return setCachedProbeResult(cacheKey, {
                ok: false,
                appId: creds.appId,
                error: `probe timed out after ${timeoutMs}ms`,
            }, PROBE_ERROR_TTL_MS);
        }
        const response = responseResult.value;
        if (options.abortSignal?.aborted) {
            return {
                ok: false,
                appId: creds.appId,
                error: "probe aborted",
            };
        }
        if (response.code !== 0) {
            return setCachedProbeResult(cacheKey, {
                ok: false,
                appId: creds.appId,
                error: `API error: ${response.msg || `code ${response.code}`}`,
            }, PROBE_ERROR_TTL_MS);
        }
        const bot = response.bot || response.data?.bot;
        return setCachedProbeResult(cacheKey, {
            ok: true,
            appId: creds.appId,
            botName: bot?.bot_name,
            botOpenId: bot?.open_id,
        }, PROBE_SUCCESS_TTL_MS);
    }
    catch (err) {
        return setCachedProbeResult(cacheKey, {
            ok: false,
            appId: creds.appId,
            error: err instanceof Error ? err.message : String(err),
        }, PROBE_ERROR_TTL_MS);
    }
}
/** Clear the probe cache (for testing). */
export function clearProbeCache() {
    probeCache.clear();
}
