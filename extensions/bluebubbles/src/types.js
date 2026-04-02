import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
const DEFAULT_TIMEOUT_MS = 10_000;
export function normalizeBlueBubblesServerUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("BlueBubbles serverUrl is required");
    }
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
}
export function buildBlueBubblesApiUrl(params) {
    const normalized = normalizeBlueBubblesServerUrl(params.baseUrl);
    const url = new URL(params.path, `${normalized}/`);
    if (params.password) {
        url.searchParams.set("password", params.password);
    }
    return url.toString();
}
// Overridable guard for testing; production code uses fetchWithSsrFGuard.
let _fetchGuard = fetchWithSsrFGuard;
/** @internal Replace the SSRF fetch guard in tests. */
export function _setFetchGuardForTesting(impl) {
    _fetchGuard = impl ?? fetchWithSsrFGuard;
}
export async function blueBubblesFetchWithTimeout(url, init, timeoutMs = DEFAULT_TIMEOUT_MS, ssrfPolicy) {
    if (ssrfPolicy !== undefined) {
        // Use SSRF-guarded fetch; buffer the body so the dispatcher can be released
        // before the caller reads the response (API responses are small JSON payloads).
        const { response, release } = await _fetchGuard({
            url,
            init,
            timeoutMs,
            policy: ssrfPolicy,
            auditContext: "bluebubbles-api",
        });
        // Null-body status codes per Fetch spec — Response constructor rejects a body for these.
        const isNullBody = response.status === 101 ||
            response.status === 204 ||
            response.status === 205 ||
            response.status === 304;
        try {
            const bodyBytes = isNullBody ? null : await response.arrayBuffer();
            return new Response(bodyBytes, { status: response.status, headers: response.headers });
        }
        finally {
            await release();
        }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
