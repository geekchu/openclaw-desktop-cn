import { createAccountListHelpers, normalizeAccountId, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-resolution";
const { listAccountIds, resolveDefaultAccountId } = createAccountListHelpers("signal");
export const listSignalAccountIds = listAccountIds;
export const resolveDefaultSignalAccountId = resolveDefaultAccountId;
function mergeSignalAccountConfig(cfg, accountId) {
    return resolveMergedAccountConfig({
        channelConfig: cfg.channels?.signal,
        accounts: cfg.channels?.signal?.accounts,
        accountId,
    });
}
export function resolveSignalAccount(params) {
    const accountId = normalizeAccountId(params.accountId);
    const baseEnabled = params.cfg.channels?.signal?.enabled !== false;
    const merged = mergeSignalAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const host = merged.httpHost?.trim() || "127.0.0.1";
    const port = merged.httpPort ?? 8080;
    const baseUrl = merged.httpUrl?.trim() || `http://${host}:${port}`;
    const configured = Boolean(merged.account?.trim() ||
        merged.httpUrl?.trim() ||
        merged.cliPath?.trim() ||
        merged.httpHost?.trim() ||
        typeof merged.httpPort === "number" ||
        typeof merged.autoStart === "boolean");
    return {
        accountId,
        enabled,
        name: merged.name?.trim() || undefined,
        baseUrl,
        configured,
        config: merged,
    };
}
export function listEnabledSignalAccounts(cfg) {
    return listSignalAccountIds(cfg)
        .map((accountId) => resolveSignalAccount({ cfg, accountId }))
        .filter((account) => account.enabled);
}
