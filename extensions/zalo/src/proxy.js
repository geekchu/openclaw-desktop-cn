import { ProxyAgent, fetch as undiciFetch } from "undici";
const proxyCache = new Map();
export function resolveZaloProxyFetch(proxyUrl) {
    const trimmed = proxyUrl?.trim();
    if (!trimmed) {
        return undefined;
    }
    const cached = proxyCache.get(trimmed);
    if (cached) {
        return cached;
    }
    const agent = new ProxyAgent(trimmed);
    const fetcher = (input, init) => undiciFetch(input, {
        ...init,
        dispatcher: agent,
    });
    proxyCache.set(trimmed, fetcher);
    return fetcher;
}
