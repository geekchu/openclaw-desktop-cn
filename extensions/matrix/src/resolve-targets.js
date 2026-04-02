import { listMatrixDirectoryGroupsLive, listMatrixDirectoryPeersLive } from "./directory-live.js";
import { isMatrixQualifiedUserId, normalizeMatrixMessagingTarget } from "./matrix/target-ids.js";
function normalizeLookupQuery(query) {
    return query.trim().toLowerCase();
}
function findExactDirectoryMatches(matches, query) {
    const normalized = normalizeLookupQuery(query);
    if (!normalized) {
        return [];
    }
    return matches.filter((match) => {
        const id = match.id.trim().toLowerCase();
        const name = match.name?.trim().toLowerCase();
        const handle = match.handle?.trim().toLowerCase();
        return normalized === id || normalized === name || normalized === handle;
    });
}
function pickBestGroupMatch(matches, query) {
    if (matches.length === 0) {
        return {};
    }
    const exact = findExactDirectoryMatches(matches, query);
    if (exact.length > 1) {
        return { best: exact[0], note: "multiple exact matches; chose first" };
    }
    if (exact.length === 1) {
        return { best: exact[0] };
    }
    return {
        best: matches[0],
        note: matches.length > 1 ? "multiple matches; chose first" : undefined,
    };
}
function pickBestUserMatch(matches, query) {
    if (matches.length === 0) {
        return undefined;
    }
    const exact = findExactDirectoryMatches(matches, query);
    if (exact.length === 1) {
        return exact[0];
    }
    return undefined;
}
function describeUserMatchFailure(matches, query) {
    if (matches.length === 0) {
        return "no matches";
    }
    const normalized = normalizeLookupQuery(query);
    if (!normalized) {
        return "empty input";
    }
    const exact = findExactDirectoryMatches(matches, normalized);
    if (exact.length === 0) {
        return "no exact match; use full Matrix ID";
    }
    if (exact.length > 1) {
        return "multiple exact matches; use full Matrix ID";
    }
    return "no exact match; use full Matrix ID";
}
async function readCachedMatches(cache, query, lookup) {
    const key = normalizeLookupQuery(query);
    if (!key) {
        return [];
    }
    const cached = cache.get(key);
    if (cached) {
        return cached;
    }
    const matches = await lookup(query.trim());
    cache.set(key, matches);
    return matches;
}
export async function resolveMatrixTargets(params) {
    const results = [];
    const userLookupCache = new Map();
    const groupLookupCache = new Map();
    for (const input of params.inputs) {
        const trimmed = input.trim();
        if (!trimmed) {
            results.push({ input, resolved: false, note: "empty input" });
            continue;
        }
        if (params.kind === "user") {
            const normalizedTarget = normalizeMatrixMessagingTarget(trimmed);
            if (normalizedTarget && isMatrixQualifiedUserId(normalizedTarget)) {
                results.push({ input, resolved: true, id: normalizedTarget });
                continue;
            }
            try {
                const matches = await readCachedMatches(userLookupCache, trimmed, (query) => listMatrixDirectoryPeersLive({
                    cfg: params.cfg,
                    accountId: params.accountId,
                    query,
                    limit: 5,
                }));
                const best = pickBestUserMatch(matches, trimmed);
                results.push({
                    input,
                    resolved: Boolean(best?.id),
                    id: best?.id,
                    name: best?.name,
                    note: best ? undefined : describeUserMatchFailure(matches, trimmed),
                });
            }
            catch (err) {
                params.runtime?.error?.(`matrix resolve failed: ${String(err)}`);
                results.push({ input, resolved: false, note: "lookup failed" });
            }
            continue;
        }
        const normalizedTarget = normalizeMatrixMessagingTarget(trimmed);
        if (normalizedTarget?.startsWith("!")) {
            results.push({ input, resolved: true, id: normalizedTarget });
            continue;
        }
        try {
            const matches = await readCachedMatches(groupLookupCache, trimmed, (query) => listMatrixDirectoryGroupsLive({
                cfg: params.cfg,
                accountId: params.accountId,
                query,
                limit: 5,
            }));
            const { best, note } = pickBestGroupMatch(matches, trimmed);
            results.push({
                input,
                resolved: Boolean(best?.id),
                id: best?.id,
                name: best?.name,
                note,
            });
        }
        catch (err) {
            params.runtime?.error?.(`matrix resolve failed: ${String(err)}`);
            results.push({ input, resolved: false, note: "lookup failed" });
        }
    }
    return results;
}
