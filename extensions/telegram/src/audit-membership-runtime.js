import { isRecord } from "openclaw/plugin-sdk/text-runtime";
import { fetchWithTimeout } from "openclaw/plugin-sdk/text-runtime";
import { resolveTelegramApiBase, resolveTelegramFetch } from "./fetch.js";
import { makeProxyFetch } from "./proxy.js";
export async function auditTelegramGroupMembershipImpl(params) {
    const proxyFetch = params.proxyUrl ? makeProxyFetch(params.proxyUrl) : undefined;
    const fetcher = resolveTelegramFetch(proxyFetch, {
        network: params.network,
    });
    const apiBase = resolveTelegramApiBase(params.apiRoot);
    const base = `${apiBase}/bot${params.token}`;
    const groups = [];
    for (const chatId of params.groupIds) {
        try {
            const url = `${base}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(String(params.botId))}`;
            const res = await fetchWithTimeout(url, {}, params.timeoutMs, fetcher);
            const json = (await res.json());
            if (!res.ok || !isRecord(json) || !json.ok) {
                const desc = isRecord(json) && !json.ok && typeof json.description === "string"
                    ? json.description
                    : `getChatMember failed (${res.status})`;
                groups.push({
                    chatId,
                    ok: false,
                    status: null,
                    error: desc,
                    matchKey: chatId,
                    matchSource: "id",
                });
                continue;
            }
            const status = isRecord(json.result) && typeof json.result.status === "string" ? json.result.status : null;
            const ok = status === "creator" || status === "administrator" || status === "member";
            groups.push({
                chatId,
                ok,
                status,
                error: ok ? null : "bot not in group",
                matchKey: chatId,
                matchSource: "id",
            });
        }
        catch (err) {
            groups.push({
                chatId,
                ok: false,
                status: null,
                error: err instanceof Error ? err.message : String(err),
                matchKey: chatId,
                matchSource: "id",
            });
        }
    }
    return {
        ok: groups.every((g) => g.ok),
        checkedGroups: groups.length,
        unresolvedGroups: 0,
        hasWildcardUnmentionedGroups: false,
        groups,
    };
}
