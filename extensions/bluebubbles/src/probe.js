import { normalizeSecretInputString } from "./secret-input.js";
import { buildBlueBubblesApiUrl, blueBubblesFetchWithTimeout } from "./types.js";
/** Cache server info by account ID to avoid repeated API calls.
 * Size-capped to prevent unbounded growth (#4948). */
const MAX_SERVER_INFO_CACHE_SIZE = 64;
const serverInfoCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
function buildCacheKey(accountId) {
    return accountId?.trim() || "default";
}
/**
 * Fetch server info from BlueBubbles API and cache it.
 * Returns cached result if available and not expired.
 */
export async function fetchBlueBubblesServerInfo(params) {
    const baseUrl = normalizeSecretInputString(params.baseUrl);
    const password = normalizeSecretInputString(params.password);
    if (!baseUrl || !password) {
        return null;
    }
    const cacheKey = buildCacheKey(params.accountId);
    const cached = serverInfoCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        return cached.info;
    }
    const ssrfPolicy = params.allowPrivateNetwork ? { allowPrivateNetwork: true } : {};
    const url = buildBlueBubblesApiUrl({ baseUrl, path: "/api/v1/server/info", password });
    try {
        const res = await blueBubblesFetchWithTimeout(url, { method: "GET" }, params.timeoutMs ?? 5000, ssrfPolicy);
        if (!res.ok) {
            return null;
        }
        const payload = (await res.json().catch(() => null));
        const data = payload?.data;
        if (data) {
            serverInfoCache.set(cacheKey, { info: data, expires: Date.now() + CACHE_TTL_MS });
            // Evict oldest entries if cache exceeds max size
            if (serverInfoCache.size > MAX_SERVER_INFO_CACHE_SIZE) {
                const oldest = serverInfoCache.keys().next().value;
                if (oldest !== undefined) {
                    serverInfoCache.delete(oldest);
                }
            }
        }
        return data ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Get cached server info synchronously (for use in describeMessageTool).
 * Returns null if not cached or expired.
 */
export function getCachedBlueBubblesServerInfo(accountId) {
    const cacheKey = buildCacheKey(accountId);
    const cached = serverInfoCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        return cached.info;
    }
    return null;
}
/**
 * Read cached private API capability for a BlueBubbles account.
 * Returns null when capability is unknown (for example, before first probe).
 */
export function getCachedBlueBubblesPrivateApiStatus(accountId) {
    const info = getCachedBlueBubblesServerInfo(accountId);
    if (!info || typeof info.private_api !== "boolean") {
        return null;
    }
    return info.private_api;
}
export function isBlueBubblesPrivateApiStatusEnabled(status) {
    return status === true;
}
export function isBlueBubblesPrivateApiEnabled(accountId) {
    return isBlueBubblesPrivateApiStatusEnabled(getCachedBlueBubblesPrivateApiStatus(accountId));
}
/**
 * Parse macOS version string (e.g., "15.0.1" or "26.0") into major version number.
 */
export function parseMacOSMajorVersion(version) {
    if (!version) {
        return null;
    }
    const match = /^(\d+)/.exec(version.trim());
    return match ? Number.parseInt(match[1], 10) : null;
}
/**
 * Check if the cached server info indicates macOS 26 or higher.
 * Returns false if no cached info is available (fail open for action listing).
 */
export function isMacOS26OrHigher(accountId) {
    const info = getCachedBlueBubblesServerInfo(accountId);
    if (!info?.os_version) {
        return false;
    }
    const major = parseMacOSMajorVersion(info.os_version);
    return major !== null && major >= 26;
}
/** Clear the server info cache (for testing) */
export function clearServerInfoCache() {
    serverInfoCache.clear();
}
export async function probeBlueBubbles(params) {
    const baseUrl = normalizeSecretInputString(params.baseUrl);
    const password = normalizeSecretInputString(params.password);
    if (!baseUrl) {
        return { ok: false, error: "serverUrl not configured" };
    }
    if (!password) {
        return { ok: false, error: "password not configured" };
    }
    const probeSsrfPolicy = params.allowPrivateNetwork ? { allowPrivateNetwork: true } : {};
    const url = buildBlueBubblesApiUrl({ baseUrl, path: "/api/v1/ping", password });
    try {
        const res = await blueBubblesFetchWithTimeout(url, { method: "GET" }, params.timeoutMs, probeSsrfPolicy);
        if (!res.ok) {
            return { ok: false, status: res.status, error: `HTTP ${res.status}` };
        }
        return { ok: true, status: res.status };
    }
    catch (err) {
        return {
            ok: false,
            status: null,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
