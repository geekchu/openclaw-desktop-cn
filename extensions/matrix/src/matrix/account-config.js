import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { listConfiguredAccountIds, resolveMergedAccountConfig, resolveNormalizedAccountEntry, } from "openclaw/plugin-sdk/account-resolution";
import { hasConfiguredSecretInput } from "openclaw/plugin-sdk/secret-input";
export function resolveMatrixBaseConfig(cfg) {
    return cfg.channels?.matrix ?? {};
}
function resolveMatrixAccountsMap(cfg) {
    const accounts = resolveMatrixBaseConfig(cfg).accounts;
    if (!accounts || typeof accounts !== "object") {
        return {};
    }
    return accounts;
}
function selectInheritedMatrixRoomEntries(params) {
    const entries = params.entries;
    if (!entries) {
        return undefined;
    }
    const selected = Object.fromEntries(Object.entries(entries).filter(([, value]) => {
        const scopedAccount = typeof value?.account === "string" ? normalizeAccountId(value.account) : undefined;
        return scopedAccount === undefined || scopedAccount === params.accountId;
    }));
    return Object.keys(selected).length > 0 ? selected : undefined;
}
function mergeMatrixRoomEntries(inherited, accountEntries, hasAccountOverride) {
    if (!inherited && !accountEntries) {
        return undefined;
    }
    if (hasAccountOverride && Object.keys(accountEntries ?? {}).length === 0) {
        return undefined;
    }
    const merged = {
        ...inherited,
    };
    for (const [key, value] of Object.entries(accountEntries ?? {})) {
        const inheritedValue = merged[key];
        merged[key] =
            inheritedValue && value
                ? {
                    ...inheritedValue,
                    ...value,
                }
                : (value ?? inheritedValue);
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
export function listNormalizedMatrixAccountIds(cfg) {
    return listConfiguredAccountIds({
        accounts: resolveMatrixAccountsMap(cfg),
        normalizeAccountId,
    });
}
export function findMatrixAccountConfig(cfg, accountId) {
    return resolveNormalizedAccountEntry(resolveMatrixAccountsMap(cfg), accountId, normalizeAccountId);
}
export function hasExplicitMatrixAccountConfig(cfg, accountId) {
    const normalized = normalizeAccountId(accountId);
    if (findMatrixAccountConfig(cfg, normalized)) {
        return true;
    }
    if (normalized !== DEFAULT_ACCOUNT_ID) {
        return false;
    }
    const matrix = resolveMatrixBaseConfig(cfg);
    return (typeof matrix.enabled === "boolean" ||
        typeof matrix.name === "string" ||
        typeof matrix.homeserver === "string" ||
        typeof matrix.userId === "string" ||
        hasConfiguredSecretInput(matrix.accessToken) ||
        hasConfiguredSecretInput(matrix.password) ||
        typeof matrix.deviceId === "string" ||
        typeof matrix.deviceName === "string" ||
        typeof matrix.avatarUrl === "string");
}
export function resolveMatrixAccountConfig(params) {
    const accountId = normalizeAccountId(params.accountId);
    const base = resolveMatrixBaseConfig(params.cfg);
    const merged = resolveMergedAccountConfig({
        channelConfig: base,
        accounts: params.cfg.channels?.matrix?.accounts,
        accountId,
        normalizeAccountId,
        nestedObjectKeys: ["dm", "actions", "execApprovals"],
    });
    const accountConfig = findMatrixAccountConfig(params.cfg, accountId);
    const groups = mergeMatrixRoomEntries(selectInheritedMatrixRoomEntries({
        entries: base.groups,
        accountId,
    }), accountConfig?.groups, Boolean(accountConfig && Object.hasOwn(accountConfig, "groups")));
    const rooms = mergeMatrixRoomEntries(selectInheritedMatrixRoomEntries({
        entries: base.rooms,
        accountId,
    }), accountConfig?.rooms, Boolean(accountConfig && Object.hasOwn(accountConfig, "rooms")));
    // Room maps need custom scoping, so keep the generic merge for all other fields.
    const { groups: _ignoredGroups, rooms: _ignoredRooms, ...rest } = merged;
    return {
        ...rest,
        ...(groups ? { groups } : {}),
        ...(rooms ? { rooms } : {}),
    };
}
