import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveAccountEntry } from "openclaw/plugin-sdk/account-resolution";
export function resolveLineGroupLookupIds(groupId) {
    const normalized = groupId?.trim();
    if (!normalized) {
        return [];
    }
    if (normalized.startsWith("group:") || normalized.startsWith("room:")) {
        const rawId = normalized.split(":").slice(1).join(":");
        return rawId ? [rawId, normalized] : [normalized];
    }
    return [normalized, `group:${normalized}`, `room:${normalized}`];
}
export function resolveLineGroupConfigEntry(groups, params) {
    if (!groups) {
        return undefined;
    }
    for (const candidate of resolveLineGroupLookupIds(params.groupId)) {
        const hit = groups[candidate];
        if (hit) {
            return hit;
        }
    }
    for (const candidate of resolveLineGroupLookupIds(params.roomId)) {
        const hit = groups[candidate];
        if (hit) {
            return hit;
        }
    }
    return groups["*"];
}
export function resolveLineGroupsConfig(cfg, accountId) {
    const lineConfig = cfg.channels?.line;
    if (!lineConfig) {
        return undefined;
    }
    const normalizedAccountId = normalizeAccountId(accountId);
    const accountGroups = resolveAccountEntry(lineConfig.accounts, normalizedAccountId)?.groups;
    return accountGroups ?? lineConfig.groups;
}
export function resolveExactLineGroupConfigKey(params) {
    const groups = resolveLineGroupsConfig(params.cfg, params.accountId);
    if (!groups) {
        return undefined;
    }
    return resolveLineGroupLookupIds(params.groupId).find((candidate) => Object.hasOwn(groups, candidate));
}
export function resolveLineGroupHistoryKey(params) {
    return params.groupId?.trim() || params.roomId?.trim() || undefined;
}
