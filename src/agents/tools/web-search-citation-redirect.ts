import { fetchWithWebToolsNetworkGuard } from "./web-guarded-fetch.js";

const REDIRECT_TIMEOUT_MS = 5000;

/**
 * Resolve a citation redirect URL to its final destination using a HEAD request.
 * Returns the original URL if resolution fails or times out.
 */
export async function resolveCitationRedirectUrl(url: string): Promise<string> {
  try {
    const { finalUrl, release } = await fetchWithWebToolsNetworkGuard({
      url,
      init: { method: "HEAD" },
      timeoutMs: REDIRECT_TIMEOUT_MS,
      useEnvProxy: true,
    });
    await release();
    return finalUrl || url;
  } catch {
    return url;
  }
}
