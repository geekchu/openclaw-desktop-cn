export function collectTelegramUnmentionedGroupIds(groups) {
    if (!groups || typeof groups !== "object") {
        return {
            groupIds: [],
            unresolvedGroups: 0,
            hasWildcardUnmentionedGroups: false,
        };
    }
    const hasWildcardUnmentionedGroups = Boolean(groups["*"]?.requireMention === false) && groups["*"]?.enabled !== false;
    const groupIds = [];
    let unresolvedGroups = 0;
    for (const [key, value] of Object.entries(groups)) {
        if (key === "*") {
            continue;
        }
        if (!value || typeof value !== "object") {
            continue;
        }
        if (value.enabled === false) {
            continue;
        }
        if (value.requireMention !== false) {
            continue;
        }
        const id = String(key).trim();
        if (!id) {
            continue;
        }
        if (/^-?\d+$/.test(id)) {
            groupIds.push(id);
        }
        else {
            unresolvedGroups += 1;
        }
    }
    groupIds.sort((a, b) => a.localeCompare(b));
    return { groupIds, unresolvedGroups, hasWildcardUnmentionedGroups };
}
let auditMembershipRuntimePromise = null;
function loadAuditMembershipRuntime() {
    auditMembershipRuntimePromise ??= import("./audit-membership-runtime.js");
    return auditMembershipRuntimePromise;
}
export async function auditTelegramGroupMembership(params) {
    const started = Date.now();
    const token = params.token?.trim() ?? "";
    if (!token || params.groupIds.length === 0) {
        return {
            ok: true,
            checkedGroups: 0,
            unresolvedGroups: 0,
            hasWildcardUnmentionedGroups: false,
            groups: [],
            elapsedMs: Date.now() - started,
        };
    }
    // Lazy import to avoid pulling `undici` (ProxyAgent) into cold-path callers that only need
    // `collectTelegramUnmentionedGroupIds` (e.g. config audits).
    const { auditTelegramGroupMembershipImpl } = await loadAuditMembershipRuntime();
    const result = await auditTelegramGroupMembershipImpl({
        ...params,
        token,
    });
    return {
        ...result,
        elapsedMs: Date.now() - started,
    };
}
