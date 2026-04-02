import { createAccountListHelpers, normalizeAccountId, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-resolution";
import { hasConfiguredSecretInput, normalizeSecretInputString } from "./secret-input.js";
import { normalizeBlueBubblesServerUrl } from "./types.js";
const { listAccountIds: listBlueBubblesAccountIds, resolveDefaultAccountId: resolveDefaultBlueBubblesAccountId, } = createAccountListHelpers("bluebubbles");
export { listBlueBubblesAccountIds, resolveDefaultBlueBubblesAccountId };
function mergeBlueBubblesAccountConfig(cfg, accountId) {
    const merged = resolveMergedAccountConfig({
        channelConfig: cfg.channels?.bluebubbles,
        accounts: cfg.channels?.bluebubbles?.accounts,
        accountId,
        omitKeys: ["defaultAccount"],
    });
    return { ...merged, chunkMode: merged.chunkMode ?? "length" };
}
export function resolveBlueBubblesAccount(params) {
    const accountId = normalizeAccountId(params.accountId);
    const baseEnabled = params.cfg.channels?.bluebubbles?.enabled;
    const merged = mergeBlueBubblesAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const serverUrl = normalizeSecretInputString(merged.serverUrl);
    const password = normalizeSecretInputString(merged.password);
    const configured = Boolean(serverUrl && hasConfiguredSecretInput(merged.password));
    const baseUrl = serverUrl ? normalizeBlueBubblesServerUrl(serverUrl) : undefined;
    return {
        accountId,
        enabled: baseEnabled !== false && accountEnabled,
        name: merged.name?.trim() || undefined,
        config: merged,
        configured,
        baseUrl,
    };
}
export function listEnabledBlueBubblesAccounts(cfg) {
    return listBlueBubblesAccountIds(cfg)
        .map((accountId) => resolveBlueBubblesAccount({ cfg, accountId }))
        .filter((account) => account.enabled);
}
