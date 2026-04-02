import { resolveMattermostAccount } from "./accounts.js";
import { createMattermostClient, fetchMattermostUser, normalizeMattermostBaseUrl, } from "./client.js";
const mattermostOpaqueTargetCache = new Map();
function cacheKey(baseUrl, token, id) {
    return `${baseUrl}::${token}::${id}`;
}
/** Mattermost IDs are 26-character lowercase alphanumeric strings. */
export function isMattermostId(value) {
    return /^[a-z0-9]{26}$/.test(value);
}
export function isExplicitMattermostTarget(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return false;
    }
    return (/^(channel|user|mattermost):/i.test(trimmed) ||
        trimmed.startsWith("@") ||
        trimmed.startsWith("#"));
}
export function parseMattermostApiStatus(err) {
    if (!err || typeof err !== "object") {
        return undefined;
    }
    const msg = "message" in err ? String(err.message ?? "") : "";
    const match = /Mattermost API (\d{3})\b/.exec(msg);
    if (!match) {
        return undefined;
    }
    const code = Number(match[1]);
    return Number.isFinite(code) ? code : undefined;
}
export async function resolveMattermostOpaqueTarget(params) {
    const input = params.input.trim();
    if (!input || isExplicitMattermostTarget(input) || !isMattermostId(input)) {
        return null;
    }
    const account = params.cfg && (!params.token || !params.baseUrl)
        ? resolveMattermostAccount({ cfg: params.cfg, accountId: params.accountId })
        : null;
    const token = params.token?.trim() || account?.botToken?.trim();
    const baseUrl = normalizeMattermostBaseUrl(params.baseUrl ?? account?.baseUrl);
    if (!token || !baseUrl) {
        return null;
    }
    const key = cacheKey(baseUrl, token, input);
    const cached = mattermostOpaqueTargetCache.get(key);
    if (cached === true) {
        return { kind: "user", id: input, to: `user:${input}` };
    }
    if (cached === false) {
        return { kind: "channel", id: input, to: `channel:${input}` };
    }
    const client = createMattermostClient({
        baseUrl,
        botToken: token,
        allowPrivateNetwork: account?.config?.allowPrivateNetwork === true,
    });
    try {
        await fetchMattermostUser(client, input);
        mattermostOpaqueTargetCache.set(key, true);
        return { kind: "user", id: input, to: `user:${input}` };
    }
    catch (err) {
        if (parseMattermostApiStatus(err) === 404) {
            mattermostOpaqueTargetCache.set(key, false);
        }
        return { kind: "channel", id: input, to: `channel:${input}` };
    }
}
export function resetMattermostOpaqueTargetCacheForTests() {
    mattermostOpaqueTargetCache.clear();
}
