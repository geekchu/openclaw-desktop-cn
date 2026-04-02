import { resolveTelegramApiBase, resolveTelegramFetch } from "./fetch.js";
import { makeProxyFetch } from "./proxy.js";
export function resolveTelegramChatLookupFetch(params) {
    const proxyUrl = params?.proxyUrl?.trim();
    const proxyFetch = proxyUrl ? makeProxyFetch(proxyUrl) : undefined;
    return resolveTelegramFetch(proxyFetch, { network: params?.network });
}
export async function lookupTelegramChatId(params) {
    return fetchTelegramChatId({
        token: params.token,
        chatId: params.chatId,
        signal: params.signal,
        apiRoot: params.apiRoot,
        fetchImpl: resolveTelegramChatLookupFetch({
            proxyUrl: params.proxyUrl,
            network: params.network,
        }),
    });
}
export async function fetchTelegramChatId(params) {
    const apiBase = resolveTelegramApiBase(params.apiRoot);
    const url = `${apiBase}/bot${params.token}/getChat?chat_id=${encodeURIComponent(params.chatId)}`;
    const fetchImpl = params.fetchImpl ?? fetch;
    try {
        const res = await fetchImpl(url, params.signal ? { signal: params.signal } : undefined);
        if (!res.ok) {
            return null;
        }
        const data = (await res.json().catch(() => null));
        const id = data?.ok ? data?.result?.id : undefined;
        if (typeof id === "number" || typeof id === "string") {
            return String(id);
        }
        return null;
    }
    catch {
        return null;
    }
}
