const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;
export function clampRuntimeAuthRefreshDelayMs(params) {
    return Math.min(MAX_SAFE_TIMEOUT_MS, Math.max(params.minDelayMs, params.refreshAt - params.now));
}
