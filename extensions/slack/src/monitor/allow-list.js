import { compileAllowlist, resolveCompiledAllowlistMatch, } from "openclaw/plugin-sdk/allow-from";
import { normalizeHyphenSlug, normalizeStringEntries, normalizeStringEntriesLower, } from "openclaw/plugin-sdk/text-runtime";
const SLACK_SLUG_CACHE_MAX = 512;
const slackSlugCache = new Map();
export function normalizeSlackSlug(raw) {
    const key = raw ?? "";
    const cached = slackSlugCache.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const normalized = normalizeHyphenSlug(raw);
    slackSlugCache.set(key, normalized);
    if (slackSlugCache.size > SLACK_SLUG_CACHE_MAX) {
        const oldest = slackSlugCache.keys().next();
        if (!oldest.done) {
            slackSlugCache.delete(oldest.value);
        }
    }
    return normalized;
}
export function normalizeAllowList(list) {
    return normalizeStringEntries(list);
}
export function normalizeAllowListLower(list) {
    return normalizeStringEntriesLower(list);
}
export function normalizeSlackAllowOwnerEntry(entry) {
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed || trimmed === "*") {
        return undefined;
    }
    const withoutPrefix = trimmed.replace(/^(slack:|user:)/, "");
    return /^u[a-z0-9]+$/.test(withoutPrefix) ? withoutPrefix : undefined;
}
export function resolveSlackAllowListMatch(params) {
    const compiledAllowList = compileAllowlist(params.allowList);
    const id = params.id?.toLowerCase();
    const name = params.name?.toLowerCase();
    const slug = normalizeSlackSlug(name);
    const candidates = [
        { value: id, source: "id" },
        { value: id ? `slack:${id}` : undefined, source: "prefixed-id" },
        { value: id ? `user:${id}` : undefined, source: "prefixed-user" },
        ...(params.allowNameMatching === true
            ? [
                { value: name, source: "name" },
                { value: name ? `slack:${name}` : undefined, source: "prefixed-name" },
                { value: slug, source: "slug" },
            ]
            : []),
    ];
    return resolveCompiledAllowlistMatch({
        compiledAllowlist: compiledAllowList,
        candidates,
    });
}
export function allowListMatches(params) {
    return resolveSlackAllowListMatch(params).allowed;
}
export function resolveSlackUserAllowed(params) {
    const allowList = normalizeAllowListLower(params.allowList);
    if (allowList.length === 0) {
        return true;
    }
    return allowListMatches({
        allowList,
        id: params.userId,
        name: params.userName,
        allowNameMatching: params.allowNameMatching,
    });
}
