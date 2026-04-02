import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { listConfiguredAccountIds, resolveNormalizedAccountEntry, } from "openclaw/plugin-sdk/account-resolution";
import { DEFAULT_ACCOUNT_ID, hasConfiguredSecretInput } from "../runtime-api.js";
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
