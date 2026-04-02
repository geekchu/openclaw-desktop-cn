import * as Lark from "@larksuiteoapi/node-sdk";
import { HttpsProxyAgent } from "https-proxy-agent";
const defaultFeishuClientSdk = {
    AppType: Lark.AppType,
    Client: Lark.Client,
    defaultHttpInstance: Lark.defaultHttpInstance,
    Domain: Lark.Domain,
    EventDispatcher: Lark.EventDispatcher,
    LoggerLevel: Lark.LoggerLevel,
    WSClient: Lark.WSClient,
};
let feishuClientSdk = defaultFeishuClientSdk;
let httpsProxyAgentCtor = HttpsProxyAgent;
/** Default HTTP timeout for Feishu API requests (30 seconds). */
export const FEISHU_HTTP_TIMEOUT_MS = 30_000;
export const FEISHU_HTTP_TIMEOUT_MAX_MS = 300_000;
export const FEISHU_HTTP_TIMEOUT_ENV_VAR = "OPENCLAW_FEISHU_HTTP_TIMEOUT_MS";
function getWsProxyAgent() {
    const proxyUrl = process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.http_proxy ||
        process.env.HTTP_PROXY;
    if (!proxyUrl)
        return undefined;
    return new httpsProxyAgentCtor(proxyUrl);
}
// Multi-account client cache
const clientCache = new Map();
function resolveDomain(domain) {
    if (domain === "lark") {
        return feishuClientSdk.Domain.Lark;
    }
    if (domain === "feishu" || !domain) {
        return feishuClientSdk.Domain.Feishu;
    }
    return domain.replace(/\/+$/, ""); // Custom URL for private deployment
}
/**
 * Create an HTTP instance that delegates to the Lark SDK's default instance
 * but injects a default request timeout to prevent indefinite hangs
 * (e.g. when the Feishu API is slow, causing per-chat queue deadlocks).
 */
function createTimeoutHttpInstance(defaultTimeoutMs) {
    const base = feishuClientSdk.defaultHttpInstance;
    function injectTimeout(opts) {
        return { timeout: defaultTimeoutMs, ...opts };
    }
    return {
        request: (opts) => base.request(injectTimeout(opts)),
        get: (url, opts) => base.get(url, injectTimeout(opts)),
        post: (url, data, opts) => base.post(url, data, injectTimeout(opts)),
        put: (url, data, opts) => base.put(url, data, injectTimeout(opts)),
        patch: (url, data, opts) => base.patch(url, data, injectTimeout(opts)),
        delete: (url, opts) => base.delete(url, injectTimeout(opts)),
        head: (url, opts) => base.head(url, injectTimeout(opts)),
        options: (url, opts) => base.options(url, injectTimeout(opts)),
    };
}
function resolveConfiguredHttpTimeoutMs(creds) {
    const clampTimeout = (value) => {
        const rounded = Math.floor(value);
        return Math.min(Math.max(rounded, 1), FEISHU_HTTP_TIMEOUT_MAX_MS);
    };
    const fromDirectField = creds.httpTimeoutMs;
    if (typeof fromDirectField === "number" &&
        Number.isFinite(fromDirectField) &&
        fromDirectField > 0) {
        return clampTimeout(fromDirectField);
    }
    const envRaw = process.env[FEISHU_HTTP_TIMEOUT_ENV_VAR];
    if (envRaw) {
        const envValue = Number(envRaw);
        if (Number.isFinite(envValue) && envValue > 0) {
            return clampTimeout(envValue);
        }
    }
    const fromConfig = creds.config?.httpTimeoutMs;
    const timeout = fromConfig;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
        return FEISHU_HTTP_TIMEOUT_MS;
    }
    return clampTimeout(timeout);
}
/**
 * Create or get a cached Feishu client for an account.
 * Accepts any object with appId, appSecret, and optional domain/accountId.
 */
export function createFeishuClient(creds) {
    const { accountId = "default", appId, appSecret, domain } = creds;
    const defaultHttpTimeoutMs = resolveConfiguredHttpTimeoutMs(creds);
    if (!appId || !appSecret) {
        throw new Error(`Feishu credentials not configured for account "${accountId}"`);
    }
    // Check cache
    const cached = clientCache.get(accountId);
    if (cached &&
        cached.config.appId === appId &&
        cached.config.appSecret === appSecret &&
        cached.config.domain === domain &&
        cached.config.httpTimeoutMs === defaultHttpTimeoutMs) {
        return cached.client;
    }
    // Create new client with timeout-aware HTTP instance
    const client = new feishuClientSdk.Client({
        appId,
        appSecret,
        appType: feishuClientSdk.AppType.SelfBuild,
        domain: resolveDomain(domain),
        httpInstance: createTimeoutHttpInstance(defaultHttpTimeoutMs),
    });
    // Cache it
    clientCache.set(accountId, {
        client,
        config: { appId, appSecret, domain, httpTimeoutMs: defaultHttpTimeoutMs },
    });
    return client;
}
/**
 * Create a Feishu WebSocket client for an account.
 * Note: WSClient is not cached since each call creates a new connection.
 */
export function createFeishuWSClient(account) {
    const { accountId, appId, appSecret, domain } = account;
    if (!appId || !appSecret) {
        throw new Error(`Feishu credentials not configured for account "${accountId}"`);
    }
    const agent = getWsProxyAgent();
    return new feishuClientSdk.WSClient({
        appId,
        appSecret,
        domain: resolveDomain(domain),
        loggerLevel: feishuClientSdk.LoggerLevel.info,
        ...(agent ? { agent } : {}),
    });
}
/**
 * Create an event dispatcher for an account.
 */
export function createEventDispatcher(account) {
    return new feishuClientSdk.EventDispatcher({
        encryptKey: account.encryptKey,
        verificationToken: account.verificationToken,
    });
}
/**
 * Get a cached client for an account (if exists).
 */
export function getFeishuClient(accountId) {
    return clientCache.get(accountId)?.client ?? null;
}
/**
 * Clear client cache for a specific account or all accounts.
 */
export function clearClientCache(accountId) {
    if (accountId) {
        clientCache.delete(accountId);
    }
    else {
        clientCache.clear();
    }
}
export function setFeishuClientRuntimeForTest(overrides) {
    feishuClientSdk = overrides?.sdk
        ? { ...defaultFeishuClientSdk, ...overrides.sdk }
        : defaultFeishuClientSdk;
    httpsProxyAgentCtor = overrides?.HttpsProxyAgent ?? HttpsProxyAgent;
}
