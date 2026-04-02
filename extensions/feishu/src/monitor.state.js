import { createFixedWindowRateLimiter, createWebhookAnomalyTracker, WEBHOOK_ANOMALY_COUNTER_DEFAULTS as WEBHOOK_ANOMALY_COUNTER_DEFAULTS_FROM_SDK, WEBHOOK_RATE_LIMIT_DEFAULTS as WEBHOOK_RATE_LIMIT_DEFAULTS_FROM_SDK, } from "../runtime-api.js";
export const wsClients = new Map();
export const httpServers = new Map();
export const botOpenIds = new Map();
export const botNames = new Map();
export const FEISHU_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
export const FEISHU_WEBHOOK_BODY_TIMEOUT_MS = 5_000;
const FEISHU_WEBHOOK_RATE_LIMIT_FALLBACK_DEFAULTS = {
    windowMs: 60_000,
    maxRequests: 120,
    maxTrackedKeys: 4_096,
};
const FEISHU_WEBHOOK_ANOMALY_FALLBACK_DEFAULTS = {
    maxTrackedKeys: 4_096,
    ttlMs: 6 * 60 * 60_000,
    logEvery: 25,
};
function coercePositiveInt(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : fallback;
}
export function resolveFeishuWebhookRateLimitDefaultsForTest(defaults) {
    const resolved = defaults;
    return {
        windowMs: coercePositiveInt(resolved?.windowMs, FEISHU_WEBHOOK_RATE_LIMIT_FALLBACK_DEFAULTS.windowMs),
        maxRequests: coercePositiveInt(resolved?.maxRequests, FEISHU_WEBHOOK_RATE_LIMIT_FALLBACK_DEFAULTS.maxRequests),
        maxTrackedKeys: coercePositiveInt(resolved?.maxTrackedKeys, FEISHU_WEBHOOK_RATE_LIMIT_FALLBACK_DEFAULTS.maxTrackedKeys),
    };
}
export function resolveFeishuWebhookAnomalyDefaultsForTest(defaults) {
    const resolved = defaults;
    return {
        maxTrackedKeys: coercePositiveInt(resolved?.maxTrackedKeys, FEISHU_WEBHOOK_ANOMALY_FALLBACK_DEFAULTS.maxTrackedKeys),
        ttlMs: coercePositiveInt(resolved?.ttlMs, FEISHU_WEBHOOK_ANOMALY_FALLBACK_DEFAULTS.ttlMs),
        logEvery: coercePositiveInt(resolved?.logEvery, FEISHU_WEBHOOK_ANOMALY_FALLBACK_DEFAULTS.logEvery),
    };
}
const feishuWebhookRateLimitDefaults = resolveFeishuWebhookRateLimitDefaultsForTest(WEBHOOK_RATE_LIMIT_DEFAULTS_FROM_SDK);
const feishuWebhookAnomalyDefaults = resolveFeishuWebhookAnomalyDefaultsForTest(WEBHOOK_ANOMALY_COUNTER_DEFAULTS_FROM_SDK);
export const feishuWebhookRateLimiter = createFixedWindowRateLimiter({
    windowMs: feishuWebhookRateLimitDefaults.windowMs,
    maxRequests: feishuWebhookRateLimitDefaults.maxRequests,
    maxTrackedKeys: feishuWebhookRateLimitDefaults.maxTrackedKeys,
});
const feishuWebhookAnomalyTracker = createWebhookAnomalyTracker({
    maxTrackedKeys: feishuWebhookAnomalyDefaults.maxTrackedKeys,
    ttlMs: feishuWebhookAnomalyDefaults.ttlMs,
    logEvery: feishuWebhookAnomalyDefaults.logEvery,
});
function closeWsClient(client) {
    if (!client)
        return;
    try {
        client.close();
    }
    catch {
        /* Best-effort cleanup */
    }
}
export function clearFeishuWebhookRateLimitStateForTest() {
    feishuWebhookRateLimiter.clear();
    feishuWebhookAnomalyTracker.clear();
}
export function getFeishuWebhookRateLimitStateSizeForTest() {
    return feishuWebhookRateLimiter.size();
}
export function isWebhookRateLimitedForTest(key, nowMs) {
    return feishuWebhookRateLimiter.isRateLimited(key, nowMs);
}
export function recordWebhookStatus(runtime, accountId, path, statusCode) {
    feishuWebhookAnomalyTracker.record({
        key: `${accountId}:${path}:${statusCode}`,
        statusCode,
        log: runtime?.log ?? console.log,
        message: (count) => `feishu[${accountId}]: webhook anomaly path=${path} status=${statusCode} count=${count}`,
    });
}
export function stopFeishuMonitorState(accountId) {
    if (accountId) {
        closeWsClient(wsClients.get(accountId));
        wsClients.delete(accountId);
        const server = httpServers.get(accountId);
        if (server) {
            server.close();
            httpServers.delete(accountId);
        }
        botOpenIds.delete(accountId);
        botNames.delete(accountId);
        return;
    }
    for (const client of wsClients.values()) {
        closeWsClient(client);
    }
    wsClients.clear();
    for (const server of httpServers.values()) {
        server.close();
    }
    httpServers.clear();
    botOpenIds.clear();
    botNames.clear();
}
