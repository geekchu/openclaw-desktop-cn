import { createAccountActionGate, createAccountListHelpers, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-helpers";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveAccountEntry } from "openclaw/plugin-sdk/routing";
import { resolveDiscordToken } from "./token.js";
const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("discord");
export const listDiscordAccountIds = listAccountIds;
export const resolveDefaultDiscordAccountId = resolveDefaultAccountId;
export function resolveDiscordAccountConfig(cfg, accountId) {
    return resolveAccountEntry(cfg.channels?.discord?.accounts, accountId);
}
export function mergeDiscordAccountConfig(cfg, accountId) {
    return resolveMergedAccountConfig({
        channelConfig: cfg.channels?.discord,
        accounts: cfg.channels?.discord?.accounts,
        accountId,
    });
}
export function createDiscordActionGate(params) {
    const accountId = normalizeAccountId(params.accountId);
    return createAccountActionGate({
        baseActions: params.cfg.channels?.discord?.actions,
        accountActions: resolveDiscordAccountConfig(params.cfg, accountId)?.actions,
    });
}
export function resolveDiscordAccount(params) {
    const accountId = normalizeAccountId(params.accountId);
    const baseEnabled = params.cfg.channels?.discord?.enabled !== false;
    const merged = mergeDiscordAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const tokenResolution = resolveDiscordToken(params.cfg, { accountId });
    return {
        accountId,
        enabled,
        name: merged.name?.trim() || undefined,
        token: tokenResolution.token,
        tokenSource: tokenResolution.source,
        config: merged,
    };
}
export function resolveDiscordMaxLinesPerMessage(params) {
    if (typeof params.discordConfig?.maxLinesPerMessage === "number") {
        return params.discordConfig.maxLinesPerMessage;
    }
    return resolveDiscordAccount({
        cfg: params.cfg,
        accountId: params.accountId,
    }).config.maxLinesPerMessage;
}
export function listEnabledDiscordAccounts(cfg) {
    return listDiscordAccountIds(cfg)
        .map((accountId) => resolveDiscordAccount({ cfg, accountId }))
        .filter((account) => account.enabled);
}
