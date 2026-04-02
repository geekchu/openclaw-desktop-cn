import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { listCombinedAccountIds } from "openclaw/plugin-sdk/account-resolution";
import { hasConfiguredSecretInput, normalizeSecretInputString, } from "openclaw/plugin-sdk/secret-input";
import { mergeDiscordAccountConfig, resolveDiscordAccountConfig } from "./accounts.js";
import { resolveDiscordToken } from "./token.js";
function inspectConfiguredToken(value) {
    const normalized = normalizeSecretInputString(value);
    if (normalized) {
        return {
            token: normalized.replace(/^Bot\s+/i, ""),
            tokenSource: "config",
            tokenStatus: "available",
        };
    }
    if (hasConfiguredSecretInput(value)) {
        return {
            token: "",
            tokenSource: "config",
            tokenStatus: "configured_unavailable",
        };
    }
    return null;
}
export function listDiscordSetupAccountIds(cfg) {
    const accounts = cfg.channels?.discord?.accounts;
    return listCombinedAccountIds({
        configuredAccountIds: accounts && typeof accounts === "object" && !Array.isArray(accounts)
            ? Object.keys(accounts).map((accountId) => normalizeAccountId(accountId))
            : [],
        implicitAccountId: DEFAULT_ACCOUNT_ID,
    });
}
export function resolveDefaultDiscordSetupAccountId(cfg) {
    return listDiscordSetupAccountIds(cfg)[0] ?? DEFAULT_ACCOUNT_ID;
}
export function resolveDiscordSetupAccountConfig(params) {
    const accountId = normalizeAccountId(params.accountId ?? DEFAULT_ACCOUNT_ID);
    return {
        accountId,
        config: mergeDiscordAccountConfig(params.cfg, accountId),
    };
}
export function inspectDiscordSetupAccount(params) {
    const { accountId, config } = resolveDiscordSetupAccountConfig(params);
    const enabled = params.cfg.channels?.discord?.enabled !== false && config.enabled !== false;
    const accountConfig = resolveDiscordAccountConfig(params.cfg, accountId);
    const hasAccountToken = Boolean(accountConfig &&
        Object.prototype.hasOwnProperty.call(accountConfig, "token"));
    const accountToken = inspectConfiguredToken(accountConfig?.token);
    if (accountToken) {
        return {
            accountId,
            enabled,
            token: accountToken.token,
            tokenSource: accountToken.tokenSource,
            tokenStatus: accountToken.tokenStatus,
            configured: true,
            config,
        };
    }
    if (hasAccountToken) {
        return {
            accountId,
            enabled,
            token: "",
            tokenSource: "none",
            tokenStatus: "missing",
            configured: false,
            config,
        };
    }
    const channelToken = inspectConfiguredToken(params.cfg.channels?.discord?.token);
    if (channelToken) {
        return {
            accountId,
            enabled,
            token: channelToken.token,
            tokenSource: channelToken.tokenSource,
            tokenStatus: channelToken.tokenStatus,
            configured: true,
            config,
        };
    }
    const tokenResolution = resolveDiscordToken(params.cfg, { accountId });
    if (tokenResolution.token) {
        return {
            accountId,
            enabled,
            token: tokenResolution.token,
            tokenSource: tokenResolution.source,
            tokenStatus: "available",
            configured: true,
            config,
        };
    }
    return {
        accountId,
        enabled,
        token: "",
        tokenSource: "none",
        tokenStatus: "missing",
        configured: false,
        config,
    };
}
