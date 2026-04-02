import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { resolveAccountEntry } from "openclaw/plugin-sdk/routing";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
export function normalizeDiscordToken(raw, path) {
    const trimmed = normalizeResolvedSecretInputString({ value: raw, path });
    if (!trimmed) {
        return undefined;
    }
    return trimmed.replace(/^Bot\s+/i, "");
}
export function resolveDiscordToken(cfg, opts = {}) {
    const accountId = normalizeAccountId(opts.accountId);
    const discordCfg = cfg?.channels?.discord;
    const accountCfg = resolveAccountEntry(discordCfg?.accounts, accountId);
    const hasAccountToken = Boolean(accountCfg &&
        Object.prototype.hasOwnProperty.call(accountCfg, "token"));
    const accountToken = normalizeDiscordToken(accountCfg?.token ?? undefined, `channels.discord.accounts.${accountId}.token`);
    if (accountToken) {
        return { token: accountToken, source: "config" };
    }
    if (hasAccountToken) {
        return { token: "", source: "none" };
    }
    const configToken = normalizeDiscordToken(discordCfg?.token ?? undefined, "channels.discord.token");
    if (configToken) {
        return { token: configToken, source: "config" };
    }
    const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
    const envToken = allowEnv
        ? normalizeDiscordToken(opts.envToken ?? process.env.DISCORD_BOT_TOKEN, "DISCORD_BOT_TOKEN")
        : undefined;
    if (envToken) {
        return { token: envToken, source: "env" };
    }
    return { token: "", source: "none" };
}
