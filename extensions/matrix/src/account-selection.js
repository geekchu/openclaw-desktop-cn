import { listCombinedAccountIds, listConfiguredAccountIds, resolveListedDefaultAccountId, resolveNormalizedAccountEntry, } from "openclaw/plugin-sdk/account-core";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId, normalizeOptionalAccountId, } from "openclaw/plugin-sdk/account-id";
import { listMatrixEnvAccountIds } from "./env-vars.js";
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function resolveMatrixChannelConfig(cfg) {
    return isRecord(cfg.channels?.matrix) ? cfg.channels.matrix : null;
}
export function findMatrixAccountEntry(cfg, accountId) {
    const channel = resolveMatrixChannelConfig(cfg);
    if (!channel) {
        return null;
    }
    const accounts = isRecord(channel.accounts) ? channel.accounts : null;
    if (!accounts) {
        return null;
    }
    const entry = resolveNormalizedAccountEntry(accounts, accountId, normalizeAccountId);
    return isRecord(entry) ? entry : null;
}
export function resolveConfiguredMatrixAccountIds(cfg, env = process.env) {
    const channel = resolveMatrixChannelConfig(cfg);
    return listCombinedAccountIds({
        configuredAccountIds: listConfiguredAccountIds({
            accounts: channel && isRecord(channel.accounts) ? channel.accounts : undefined,
            normalizeAccountId,
        }),
        additionalAccountIds: listMatrixEnvAccountIds(env),
        fallbackAccountIdWhenEmpty: channel ? DEFAULT_ACCOUNT_ID : undefined,
    });
}
export function resolveMatrixDefaultOrOnlyAccountId(cfg, env = process.env) {
    const channel = resolveMatrixChannelConfig(cfg);
    if (!channel) {
        return DEFAULT_ACCOUNT_ID;
    }
    const configuredDefault = normalizeOptionalAccountId(typeof channel.defaultAccount === "string" ? channel.defaultAccount : undefined);
    const configuredAccountIds = resolveConfiguredMatrixAccountIds(cfg, env);
    return resolveListedDefaultAccountId({
        accountIds: configuredAccountIds,
        configuredDefaultAccountId: configuredDefault,
        ambiguousFallbackAccountId: DEFAULT_ACCOUNT_ID,
    });
}
export function requiresExplicitMatrixDefaultAccount(cfg, env = process.env) {
    const channel = resolveMatrixChannelConfig(cfg);
    if (!channel) {
        return false;
    }
    const configuredAccountIds = resolveConfiguredMatrixAccountIds(cfg, env);
    if (configuredAccountIds.length <= 1) {
        return false;
    }
    const configuredDefault = normalizeOptionalAccountId(typeof channel.defaultAccount === "string" ? channel.defaultAccount : undefined);
    return !(configuredDefault && configuredAccountIds.includes(configuredDefault));
}
