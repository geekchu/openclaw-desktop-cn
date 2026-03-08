/**
 * Onestop API endpoint failover
 *
 * Primary:  api2.openclawcn.net
 * Fallback: api.openclawcn.net
 *
 * When the primary endpoint fails, requests are routed to the fallback.
 * A background health check periodically probes the primary and switches
 * back once it recovers.
 */

const PRIMARY_HOST = "api2.openclawcn.net";
const FALLBACK_HOST = "api.openclawcn.net";

const PRIMARY_BASE_URL = `https://${PRIMARY_HOST}/v1`;
const FALLBACK_BASE_URL = `https://${FALLBACK_HOST}/v1`;

/** How often (ms) to probe the primary when we're on the fallback. */
const HEALTH_CHECK_INTERVAL_MS = 300_000; // 300 s

/** Timeout (ms) for a single health-check probe. */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

let _usingPrimary = true;
let _healthTimer: ReturnType<typeof setInterval> | null = null;

// ── public API ──────────────────────────────────────────────

/** Return the base URL that should be used right now. */
export function getOnestopBaseUrl(): string {
  return _usingPrimary ? PRIMARY_BASE_URL : FALLBACK_BASE_URL;
}

/** Return the host portion (for display / CSP). */
export function getOnestopHost(): string {
  return _usingPrimary ? PRIMARY_HOST : FALLBACK_HOST;
}

/** Whether we are currently on the primary endpoint. */
export function isUsingPrimary(): boolean {
  return _usingPrimary;
}

/**
 * Mark the primary as down and switch to fallback.
 * Starts the background health-check timer if not already running.
 */
export function switchToFallback(): void {
  if (!_usingPrimary) return;
  _usingPrimary = false;
  startHealthCheck();
}

/**
 * Mark the primary as healthy and switch back.
 * Stops the background health-check timer.
 */
export function switchToPrimary(): void {
  _usingPrimary = true;
  stopHealthCheck();
}

/**
 * Rewrite a model's baseUrl if it points to the onestop endpoint.
 * Returns the (possibly rewritten) URL.
 */
export function resolveOnestopUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return baseUrl;
  // Only rewrite URLs that belong to the onestop service
  if (baseUrl.includes(PRIMARY_HOST) || baseUrl.includes(FALLBACK_HOST)) {
    return getOnestopBaseUrl();
  }
  return baseUrl;
}

// ── health check ────────────────────────────────────────────

async function probePrimary(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    const res = await fetch(`${PRIMARY_BASE_URL}/models`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function healthCheckTick(): Promise<void> {
  const ok = await probePrimary();
  if (ok) {
    switchToPrimary();
  }
}

function startHealthCheck(): void {
  if (_healthTimer) return;
  _healthTimer = setInterval(() => {
    void healthCheckTick();
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthCheck(): void {
  if (_healthTimer) {
    clearInterval(_healthTimer);
    _healthTimer = null;
  }
}

// ── constants for external consumers ────────────────────────

export { PRIMARY_HOST, FALLBACK_HOST, PRIMARY_BASE_URL, FALLBACK_BASE_URL };
