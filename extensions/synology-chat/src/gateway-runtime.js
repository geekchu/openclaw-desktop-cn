import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-resolution";
import { registerPluginHttpRoute } from "openclaw/plugin-sdk/webhook-ingress";
import { listAccountIds, resolveAccount } from "./accounts.js";
import { dispatchSynologyChatInboundTurn } from "./inbound-turn.js";
import { createWebhookHandler } from "./webhook-handler.js";
const CHANNEL_ID = "synology-chat";
const activeRouteUnregisters = new Map();
function buildStartupIssue(code, message, logLevel = "warn") {
    return { code, logLevel, message };
}
function logStartupIssues(log, issues) {
    for (const issue of issues) {
        const message = `Synology Chat ${issue.message}`;
        if (issue.logLevel === "info") {
            log?.info?.(message);
            continue;
        }
        log?.warn?.(message);
    }
}
function getRouteKey(account) {
    return `${account.accountId}:${account.webhookPath}`;
}
function createUnknownArgsLogAdapter(log) {
    if (!log) {
        return undefined;
    }
    return {
        info: (...args) => log.info?.(String(args[0] ?? "")),
        warn: (...args) => log.warn?.(String(args[0] ?? "")),
        error: (...args) => log.error?.(String(args[0] ?? "")),
    };
}
export function collectSynologyGatewayStartupIssues(params) {
    const { cfg, account, accountId } = params;
    const issues = [];
    if (!account.enabled) {
        issues.push(buildStartupIssue("disabled", `account ${accountId} is disabled, skipping`, "info"));
        return issues;
    }
    if (!account.token || !account.incomingUrl) {
        issues.push(buildStartupIssue("missing-credentials", `account ${accountId} not fully configured (missing token or incomingUrl)`));
    }
    if (account.dmPolicy === "allowlist" && account.allowedUserIds.length === 0) {
        issues.push(buildStartupIssue("empty-allowlist", `account ${accountId} has dmPolicy=allowlist but empty allowedUserIds; refusing to start route`));
    }
    const accountIds = listAccountIds(cfg);
    const isMultiAccount = accountIds.length > 1;
    if (isMultiAccount &&
        accountId !== DEFAULT_ACCOUNT_ID &&
        account.webhookPathSource === "inherited-base" &&
        !account.dangerouslyAllowInheritedWebhookPath) {
        issues.push(buildStartupIssue("inherited-shared-webhook-path", `account ${accountId} must set an explicit webhookPath in multi-account setups; refusing inherited shared path. Set channels.synology-chat.accounts.${accountId}.webhookPath or opt in with dangerouslyAllowInheritedWebhookPath=true.`));
    }
    const conflictingAccounts = accountIds.filter((candidateId) => {
        if (candidateId === accountId) {
            return false;
        }
        const candidate = resolveAccount(cfg, candidateId);
        return candidate.enabled && candidate.webhookPath === account.webhookPath;
    });
    if (conflictingAccounts.length > 0) {
        issues.push(buildStartupIssue("duplicate-webhook-path", `account ${accountId} conflicts on webhookPath ${account.webhookPath} with ${conflictingAccounts.join(", ")}; refusing to start ambiguous shared route.`));
    }
    return issues;
}
export function collectSynologyGatewayRoutingWarnings(params) {
    return collectSynologyGatewayStartupIssues({
        cfg: params.cfg,
        account: params.account,
        accountId: params.account.accountId,
    })
        .filter((issue) => issue.code === "inherited-shared-webhook-path" || issue.code === "duplicate-webhook-path")
        .map((issue) => `- Synology Chat: ${issue.message}`);
}
export function validateSynologyGatewayAccountStartup(params) {
    const issues = collectSynologyGatewayStartupIssues(params);
    if (issues.length > 0) {
        logStartupIssues(params.log, issues);
        return { ok: false };
    }
    return { ok: true };
}
export function registerSynologyWebhookRoute(params) {
    const { account, log } = params;
    const routeKey = getRouteKey(account);
    const prevUnregister = activeRouteUnregisters.get(routeKey);
    if (prevUnregister) {
        log?.info?.(`Deregistering stale route before re-registering: ${account.webhookPath}`);
        prevUnregister();
        activeRouteUnregisters.delete(routeKey);
    }
    const handler = createWebhookHandler({
        account,
        deliver: async (msg) => await dispatchSynologyChatInboundTurn({
            account,
            msg,
            log: createUnknownArgsLogAdapter(log),
        }),
        log: createUnknownArgsLogAdapter(log),
    });
    const unregister = registerPluginHttpRoute({
        path: account.webhookPath,
        auth: "plugin",
        pluginId: CHANNEL_ID,
        accountId: account.accountId,
        log: (msg) => log?.info?.(msg),
        handler,
    });
    activeRouteUnregisters.set(routeKey, unregister);
    return () => {
        unregister();
        activeRouteUnregisters.delete(routeKey);
    };
}
