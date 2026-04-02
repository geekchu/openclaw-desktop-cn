import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import { normalizeResolvedSecretInputString, normalizeSecretInputString } from "../secret-input.js";
import { normalizeMattermostBaseUrl } from "./client.js";
const mattermostAccountHelpers = createAccountListHelpers("mattermost");
export function listMattermostAccountIds(cfg) {
    return mattermostAccountHelpers.listAccountIds(cfg);
}
export function resolveDefaultMattermostAccountId(cfg) {
    return mattermostAccountHelpers.resolveDefaultAccountId(cfg);
}
function mergeMattermostAccountConfig(cfg, accountId) {
    return resolveMergedAccountConfig({
        channelConfig: cfg.channels?.mattermost,
        accounts: cfg.channels?.mattermost?.accounts,
        accountId,
        omitKeys: ["defaultAccount"],
        nestedObjectKeys: ["commands"],
    });
}
function resolveMattermostRequireMention(config) {
    if (config.chatmode === "oncall") {
        return true;
    }
    if (config.chatmode === "onmessage") {
        return false;
    }
    if (config.chatmode === "onchar") {
        return true;
    }
    return config.requireMention;
}
export function resolveMattermostAccount(params) {
    const accountId = normalizeAccountId(params.accountId);
    const baseEnabled = params.cfg.channels?.mattermost?.enabled !== false;
    const merged = mergeMattermostAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;
    const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
    const envToken = allowEnv ? process.env.MATTERMOST_BOT_TOKEN?.trim() : undefined;
    const envUrl = allowEnv ? process.env.MATTERMOST_URL?.trim() : undefined;
    const configToken = params.allowUnresolvedSecretRef
        ? normalizeSecretInputString(merged.botToken)
        : normalizeResolvedSecretInputString({
            value: merged.botToken,
            path: `channels.mattermost.accounts.${accountId}.botToken`,
        });
    const configUrl = merged.baseUrl?.trim();
    const botToken = configToken || envToken;
    const baseUrl = normalizeMattermostBaseUrl(configUrl || envUrl);
    const requireMention = resolveMattermostRequireMention(merged);
    const botTokenSource = configToken ? "config" : envToken ? "env" : "none";
    const baseUrlSource = configUrl ? "config" : envUrl ? "env" : "none";
    return {
        accountId,
        enabled,
        name: merged.name?.trim() || undefined,
        botToken,
        baseUrl,
        botTokenSource,
        baseUrlSource,
        config: merged,
        chatmode: merged.chatmode,
        oncharPrefixes: merged.oncharPrefixes,
        requireMention,
        textChunkLimit: merged.textChunkLimit,
        blockStreaming: merged.blockStreaming,
        blockStreamingCoalesce: merged.blockStreamingCoalesce,
    };
}
/**
 * Resolve the effective replyToMode for a given chat type.
 * Mattermost auto-threading only applies to channel and group messages.
 */
export function resolveMattermostReplyToMode(account, kind) {
    if (kind === "direct") {
        return "off";
    }
    return account.config.replyToMode ?? "off";
}
export function listEnabledMattermostAccounts(cfg) {
    return listMattermostAccountIds(cfg)
        .map((accountId) => resolveMattermostAccount({ cfg, accountId }))
        .filter((account) => account.enabled);
}
