import { createAccountListHelpers, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-helpers";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveZaloToken } from "./token.js";
const { listAccountIds: listZaloAccountIds, resolveDefaultAccountId: resolveDefaultZaloAccountId } = createAccountListHelpers("zalo");
export { listZaloAccountIds, resolveDefaultZaloAccountId };
function mergeZaloAccountConfig(cfg, accountId) {
    return resolveMergedAccountConfig({
        channelConfig: cfg.channels?.zalo,
        accounts: cfg.channels?.zalo?.accounts,
        accountId,
        omitKeys: ["defaultAccount"],
    });
}
export function resolveZaloAccount(params) {
    const accountId = normalizeAccountId(params.accountId);
    const baseEnabled = params.cfg.channels?.zalo?.enabled !== false;
    const merged = mergeZaloAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const tokenResolution = resolveZaloToken(params.cfg.channels?.zalo, accountId, { allowUnresolvedSecretRef: params.allowUnresolvedSecretRef });
    return {
        accountId,
        name: merged.name?.trim() || undefined,
        enabled,
        token: tokenResolution.token,
        tokenSource: tokenResolution.source,
        config: merged,
    };
}
export function listEnabledZaloAccounts(cfg) {
    return listZaloAccountIds(cfg)
        .map((accountId) => resolveZaloAccount({ cfg, accountId }))
        .filter((account) => account.enabled);
}
