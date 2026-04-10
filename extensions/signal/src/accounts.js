import { createAccountListHelpers, normalizeAccountId, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-resolution";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
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
    const accountId = normalizeAccountId(params.accountId ?? resolveDefaultSignalAccountId(params.cfg));
    const baseEnabled = params.cfg.channels?.signal?.enabled !== false;
    const merged = mergeSignalAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const host = normalizeOptionalString(merged.httpHost) ?? "127.0.0.1";
    const port = merged.httpPort ?? 8080;
    const baseUrl = normalizeOptionalString(merged.httpUrl) ?? `http://${host}:${port}`;
    const configured = Boolean(normalizeOptionalString(merged.account) ||
        normalizeOptionalString(merged.httpUrl) ||
        normalizeOptionalString(merged.cliPath) ||
        normalizeOptionalString(merged.httpHost) ||
        typeof merged.httpPort === "number" ||
        typeof merged.autoStart === "boolean");
    return {
        accountId,
        enabled,
        name: normalizeOptionalString(merged.name),
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
