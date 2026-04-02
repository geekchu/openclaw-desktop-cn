/**
 * Account resolution: reads config from channels.synology-chat,
 * merges per-account overrides, falls back to environment variables.
 */
import { DEFAULT_ACCOUNT_ID, listCombinedAccountIds, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-resolution";
import { resolveDangerousNameMatchingEnabled } from "openclaw/plugin-sdk/config-runtime";
/** Extract the channel config from the full OpenClaw config object. */
function getChannelConfig(cfg) {
    return cfg?.channels?.["synology-chat"];
}
function resolveImplicitAccountId(channelCfg) {
    return channelCfg.token || process.env.SYNOLOGY_CHAT_TOKEN ? DEFAULT_ACCOUNT_ID : undefined;
}
function getRawAccountConfig(channelCfg, accountId) {
    if (accountId === DEFAULT_ACCOUNT_ID) {
        return channelCfg;
    }
    return channelCfg.accounts?.[accountId] ?? {};
}
function hasExplicitWebhookPath(rawAccount) {
    return typeof rawAccount?.webhookPath === "string" && rawAccount.webhookPath.trim().length > 0;
}
function resolveWebhookPathSource(params) {
    if (hasExplicitWebhookPath(params.rawAccount)) {
        return "explicit";
    }
    if (params.accountId !== DEFAULT_ACCOUNT_ID && hasExplicitWebhookPath(params.channelCfg)) {
        return "inherited-base";
    }
    return "default";
}
/** Parse allowedUserIds from string or array to string[]. */
function parseAllowedUserIds(raw) {
    if (!raw)
        return [];
    if (Array.isArray(raw))
        return raw.filter(Boolean);
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
function parseRateLimitPerMinute(raw) {
    if (raw == null) {
        return 30;
    }
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) {
        return 30;
    }
    return Number.parseInt(trimmed, 10);
}
/**
 * List all configured account IDs for this channel.
 * Returns ["default"] if there's a base config, plus any named accounts.
 */
export function listAccountIds(cfg) {
    const channelCfg = getChannelConfig(cfg);
    if (!channelCfg) {
        return [];
    }
    return listCombinedAccountIds({
        configuredAccountIds: Object.keys(channelCfg.accounts ?? {}),
        implicitAccountId: resolveImplicitAccountId(channelCfg),
    });
}
/**
 * Resolve a specific account by ID with full defaults applied.
 * Falls back to env vars for the "default" account.
 */
export function resolveAccount(cfg, accountId) {
    const channelCfg = getChannelConfig(cfg) ?? {};
    const id = accountId || DEFAULT_ACCOUNT_ID;
    const accountOverrides = id === DEFAULT_ACCOUNT_ID ? undefined : (channelCfg.accounts?.[id] ?? undefined);
    const rawAccount = getRawAccountConfig(channelCfg, id);
    const merged = resolveMergedAccountConfig({
        channelConfig: channelCfg,
        accounts: channelCfg.accounts,
        accountId: id,
    });
    // Env var fallbacks (primarily for the "default" account)
    const envToken = process.env.SYNOLOGY_CHAT_TOKEN ?? "";
    const envIncomingUrl = process.env.SYNOLOGY_CHAT_INCOMING_URL ?? "";
    const envNasHost = process.env.SYNOLOGY_NAS_HOST ?? "localhost";
    const envAllowedUserIds = process.env.SYNOLOGY_ALLOWED_USER_IDS ?? "";
    const envRateLimitValue = parseRateLimitPerMinute(process.env.SYNOLOGY_RATE_LIMIT);
    const envBotName = process.env.OPENCLAW_BOT_NAME ?? "OpenClaw";
    const webhookPathSource = resolveWebhookPathSource({ accountId: id, channelCfg, rawAccount });
    const dangerouslyAllowInheritedWebhookPath = rawAccount.dangerouslyAllowInheritedWebhookPath ??
        channelCfg.dangerouslyAllowInheritedWebhookPath ??
        false;
    // Merge: account override > base channel config > env var
    return {
        accountId: id,
        enabled: merged.enabled ?? true,
        token: merged.token ?? envToken,
        incomingUrl: merged.incomingUrl ?? envIncomingUrl,
        nasHost: merged.nasHost ?? envNasHost,
        webhookPath: merged.webhookPath ?? "/webhook/synology",
        webhookPathSource,
        dangerouslyAllowNameMatching: resolveDangerousNameMatchingEnabled({
            providerConfig: channelCfg,
            accountConfig: accountOverrides,
        }),
        dangerouslyAllowInheritedWebhookPath,
        dmPolicy: merged.dmPolicy ?? "allowlist",
        allowedUserIds: parseAllowedUserIds(merged.allowedUserIds ?? envAllowedUserIds),
        rateLimitPerMinute: merged.rateLimitPerMinute ?? envRateLimitValue,
        botName: merged.botName ?? envBotName,
        allowInsecureSsl: merged.allowInsecureSsl ?? false,
    };
}
