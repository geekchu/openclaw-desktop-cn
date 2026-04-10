import { RequestClient } from "@buape/carbon";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import { mergeDiscordAccountConfig, resolveDiscordAccount, } from "./accounts.js";
import { resolveDiscordProxyFetchForAccount } from "./proxy-fetch.js";
import { createDiscordRequestClient } from "./proxy-request-client.js";
import { createDiscordRetryRunner } from "./retry.js";
import { normalizeDiscordToken } from "./token.js";
export function createDiscordRuntimeAccountContext(params) {
    return {
        cfg: params.cfg,
        accountId: normalizeAccountId(params.accountId),
    };
}
export function resolveDiscordClientAccountContext(opts, cfg, runtime) {
    const resolvedCfg = opts.cfg ?? cfg ?? loadConfig();
    const account = resolveAccountWithoutToken({
        cfg: resolvedCfg,
        accountId: opts.accountId,
    });
    return {
        cfg: resolvedCfg,
        account,
        proxyFetch: resolveDiscordProxyFetchForAccount(account, resolvedCfg, runtime),
    };
}
function resolveToken(params) {
    const fallback = normalizeDiscordToken(params.fallbackToken, "channels.discord.token");
    if (!fallback) {
        throw new Error(`Discord bot token missing for account "${params.accountId}" (set discord.accounts.${params.accountId}.token or DISCORD_BOT_TOKEN for default).`);
    }
    return fallback;
}
export function resolveDiscordProxyFetch(opts, cfg, runtime) {
    return resolveDiscordClientAccountContext(opts, cfg, runtime).proxyFetch;
}
function resolveRest(token, account, cfg, rest, proxyFetch) {
    if (rest) {
        return rest;
    }
    const resolvedProxyFetch = proxyFetch ?? resolveDiscordProxyFetchForAccount(account, cfg);
    return createDiscordRequestClient(token, resolvedProxyFetch ? { fetch: resolvedProxyFetch } : undefined);
}
function resolveAccountWithoutToken(params) {
    const accountId = normalizeAccountId(params.accountId);
    const merged = mergeDiscordAccountConfig(params.cfg, accountId);
    const baseEnabled = params.cfg.channels?.discord?.enabled !== false;
    const accountEnabled = merged.enabled !== false;
    return {
        accountId,
        enabled: baseEnabled && accountEnabled,
        name: normalizeOptionalString(merged.name),
        token: "",
        tokenSource: "none",
        config: merged,
    };
}
export function createDiscordRestClient(opts, cfg) {
    const explicitToken = normalizeDiscordToken(opts.token, "channels.discord.token");
    const proxyContext = resolveDiscordClientAccountContext(opts, cfg);
    const resolvedCfg = proxyContext.cfg;
    const account = explicitToken
        ? proxyContext.account
        : resolveDiscordAccount({ cfg: resolvedCfg, accountId: opts.accountId });
    const token = explicitToken ??
        resolveToken({
            accountId: account.accountId,
            fallbackToken: account.token,
        });
    const rest = resolveRest(token, account, resolvedCfg, opts.rest, proxyContext.proxyFetch);
    return { token, rest, account };
}
export function createDiscordClient(opts, cfg) {
    const { token, rest, account } = createDiscordRestClient(opts, opts.cfg ?? cfg);
    const request = createDiscordRetryRunner({
        retry: opts.retry,
        configRetry: account.config.retry,
        verbose: opts.verbose,
    });
    return { token, rest, request };
}
export function resolveDiscordRest(opts) {
    return createDiscordRestClient(opts, opts.cfg).rest;
}
