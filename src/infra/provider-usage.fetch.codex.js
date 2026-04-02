import { buildUsageHttpErrorSnapshot, fetchJson } from "./provider-usage.fetch.shared.js";
import { clampPercent, PROVIDER_LABELS } from "./provider-usage.shared.js";
const WEEKLY_RESET_GAP_SECONDS = 3 * 24 * 60 * 60;
function resolveSecondaryWindowLabel(params) {
    if (params.windowHours >= 168) {
        return "Week";
    }
    if (params.windowHours < 24) {
        return `${params.windowHours}h`;
    }
    // Codex occasionally reports a 24h secondary window while exposing a
    // weekly reset cadence in reset timestamps. Prefer cadence in that case.
    if (typeof params.secondaryResetAt === "number" &&
        typeof params.primaryResetAt === "number" &&
        params.secondaryResetAt - params.primaryResetAt >= WEEKLY_RESET_GAP_SECONDS) {
        return "Week";
    }
    return "Day";
}
export async function fetchCodexUsage(token, accountId, timeoutMs, fetchFn) {
    const headers = {
        Authorization: `Bearer ${token}`,
        "User-Agent": "CodexBar",
        Accept: "application/json",
    };
    if (accountId) {
        headers["ChatGPT-Account-Id"] = accountId;
    }
    const res = await fetchJson("https://chatgpt.com/backend-api/wham/usage", { method: "GET", headers }, timeoutMs, fetchFn);
    if (!res.ok) {
        return buildUsageHttpErrorSnapshot({
            provider: "openai-codex",
            status: res.status,
            tokenExpiredStatuses: [401, 403],
        });
    }
    const data = (await res.json());
    const windows = [];
    if (data.rate_limit?.primary_window) {
        const pw = data.rate_limit.primary_window;
        const windowHours = Math.round((pw.limit_window_seconds || 10800) / 3600);
        windows.push({
            label: `${windowHours}h`,
            usedPercent: clampPercent(pw.used_percent || 0),
            resetAt: pw.reset_at ? pw.reset_at * 1000 : undefined,
        });
    }
    if (data.rate_limit?.secondary_window) {
        const sw = data.rate_limit.secondary_window;
        const windowHours = Math.round((sw.limit_window_seconds || 86400) / 3600);
        const label = resolveSecondaryWindowLabel({
            windowHours,
            primaryResetAt: data.rate_limit?.primary_window?.reset_at,
            secondaryResetAt: sw.reset_at,
        });
        windows.push({
            label,
            usedPercent: clampPercent(sw.used_percent || 0),
            resetAt: sw.reset_at ? sw.reset_at * 1000 : undefined,
        });
    }
    let plan = data.plan_type;
    if (data.credits?.balance !== undefined && data.credits.balance !== null) {
        const balance = typeof data.credits.balance === "number"
            ? data.credits.balance
            : parseFloat(data.credits.balance) || 0;
        plan = plan ? `${plan} ($${balance.toFixed(2)})` : `$${balance.toFixed(2)}`;
    }
    return {
        provider: "openai-codex",
        displayName: PROVIDER_LABELS["openai-codex"],
        windows,
        plan,
    };
}
