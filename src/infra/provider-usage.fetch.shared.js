import { parseFiniteNumber as parseFiniteNumberish } from "./parse-finite-number.js";
import { PROVIDER_LABELS } from "./provider-usage.shared.js";
export async function fetchJson(url, init, timeoutMs, fetchFn) {
    const controller = new AbortController();
    const timer = setTimeout(controller.abort.bind(controller), timeoutMs);
    try {
        return await fetchFn(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
export function parseFiniteNumber(value) {
    return parseFiniteNumberish(value);
}
export function buildUsageErrorSnapshot(provider, error) {
    return {
        provider,
        displayName: PROVIDER_LABELS[provider],
        windows: [],
        error,
    };
}
export function buildUsageHttpErrorSnapshot(options) {
    const tokenExpiredStatuses = options.tokenExpiredStatuses ?? [];
    if (tokenExpiredStatuses.includes(options.status)) {
        return buildUsageErrorSnapshot(options.provider, "Token expired");
    }
    const suffix = options.message?.trim() ? `: ${options.message.trim()}` : "";
    return buildUsageErrorSnapshot(options.provider, `HTTP ${options.status}${suffix}`);
}
