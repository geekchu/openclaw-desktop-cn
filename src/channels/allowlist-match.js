export function formatAllowlistMatchMeta(match) {
    return `matchKey=${match?.matchKey ?? "none"} matchSource=${match?.matchSource ?? "none"}`;
}
export function compileAllowlist(entries) {
    const set = new Set(entries.filter(Boolean));
    return {
        set,
        wildcard: set.has("*"),
    };
}
function compileSimpleAllowlist(entries) {
    return compileAllowlist(entries.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean));
}
export function resolveAllowlistCandidates(params) {
    for (const candidate of params.candidates) {
        if (!candidate.value) {
            continue;
        }
        if (params.compiledAllowlist.set.has(candidate.value)) {
            return {
                allowed: true,
                matchKey: candidate.value,
                matchSource: candidate.source,
            };
        }
    }
    return { allowed: false };
}
export function resolveCompiledAllowlistMatch(params) {
    if (params.compiledAllowlist.set.size === 0) {
        return { allowed: false };
    }
    if (params.compiledAllowlist.wildcard) {
        return { allowed: true, matchKey: "*", matchSource: "wildcard" };
    }
    return resolveAllowlistCandidates(params);
}
export function resolveAllowlistMatchByCandidates(params) {
    return resolveCompiledAllowlistMatch({
        compiledAllowlist: compileAllowlist(params.allowList),
        candidates: params.candidates,
    });
}
export function resolveAllowlistMatchSimple(params) {
    const allowFrom = compileSimpleAllowlist(params.allowFrom);
    if (allowFrom.set.size === 0) {
        return { allowed: false };
    }
    if (allowFrom.wildcard) {
        return { allowed: true, matchKey: "*", matchSource: "wildcard" };
    }
    const senderId = params.senderId.toLowerCase();
    const senderName = params.senderName?.toLowerCase();
    return resolveAllowlistCandidates({
        compiledAllowlist: allowFrom,
        candidates: [
            { value: senderId, source: "id" },
            ...(params.allowNameMatching === true && senderName
                ? [{ value: senderName, source: "name" }]
                : []),
        ],
    });
}
