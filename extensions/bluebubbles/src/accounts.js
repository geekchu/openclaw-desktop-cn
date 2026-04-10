import { createAccountListHelpers, normalizeAccountId, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-resolution";
import { resolveChannelStreamingChunkMode } from "openclaw/plugin-sdk/channel-streaming";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { normalizeBlueBubblesAccountsMap, normalizeBlueBubblesPrivateNetworkAliases, resolveBlueBubblesEffectiveAllowPrivateNetworkFromConfig, resolveBlueBubblesPrivateNetworkConfigValue as resolveBlueBubblesPrivateNetworkConfigValueFromRecord, } from "./accounts-normalization.js";
import { hasConfiguredSecretInput, normalizeSecretInputString } from "./secret-input.js";
import { normalizeBlueBubblesServerUrl } from "./types.js";
const { listAccountIds: listBlueBubblesAccountIds, resolveDefaultAccountId: resolveDefaultBlueBubblesAccountId, } = createAccountListHelpers("bluebubbles");
export { listBlueBubblesAccountIds, resolveDefaultBlueBubblesAccountId };
function mergeBlueBubblesAccountConfig(cfg, accountId) {
    const channelConfig = normalizeBlueBubblesPrivateNetworkAliases(cfg.channels?.bluebubbles);
    const accounts = normalizeBlueBubblesAccountsMap(cfg.channels?.bluebubbles?.accounts);
    const merged = resolveMergedAccountConfig({
        channelConfig,
        accounts,
        accountId,
        omitKeys: ["defaultAccount"],
        normalizeAccountId,
        nestedObjectKeys: ["network"],
    });
    return {
        ...merged,
        chunkMode: resolveChannelStreamingChunkMode(merged) ?? merged.chunkMode ?? "length",
    };
}
export function resolveBlueBubblesAccount(params) {
    const accountId = normalizeAccountId(params.accountId ?? resolveDefaultBlueBubblesAccountId(params.cfg));
    const baseEnabled = params.cfg.channels?.bluebubbles?.enabled;
    const merged = mergeBlueBubblesAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const serverUrl = normalizeSecretInputString(merged.serverUrl);
    const configured = Boolean(serverUrl && hasConfiguredSecretInput(merged.password));
    const baseUrl = serverUrl ? normalizeBlueBubblesServerUrl(serverUrl) : undefined;
    return {
        accountId,
        enabled: baseEnabled !== false && accountEnabled,
        name: normalizeOptionalString(merged.name),
        config: merged,
        configured,
        baseUrl,
    };
}
export function resolveBlueBubblesPrivateNetworkConfigValue(config) {
    return resolveBlueBubblesPrivateNetworkConfigValueFromRecord(config);
}
export function resolveBlueBubblesEffectiveAllowPrivateNetwork(params) {
    return resolveBlueBubblesEffectiveAllowPrivateNetworkFromConfig(params);
}
export function listEnabledBlueBubblesAccounts(cfg) {
    return listBlueBubblesAccountIds(cfg)
        .map((accountId) => resolveBlueBubblesAccount({ cfg, accountId }))
        .filter((account) => account.enabled);
}
