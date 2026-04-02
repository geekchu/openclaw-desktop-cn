import { hasMeaningfulChannelConfig } from "../channels/config-presence.js";
import { hasAnyWhatsAppAuth } from "../plugin-sdk/whatsapp.js";
import { isRecord } from "../utils.js";
function hasNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function accountsHaveKeys(value, keys) {
    if (!isRecord(value)) {
        return false;
    }
    for (const account of Object.values(value)) {
        if (!isRecord(account)) {
            continue;
        }
        for (const key of keys) {
            if (hasNonEmptyString(account[key])) {
                return true;
            }
        }
    }
    return false;
}
function resolveChannelConfig(cfg, channelId) {
    const channels = cfg.channels;
    const entry = channels?.[channelId];
    return isRecord(entry) ? entry : null;
}
const STRUCTURED_CHANNEL_CONFIG_SPECS = {
    telegram: {
        envAny: ["TELEGRAM_BOT_TOKEN"],
        stringKeys: ["botToken", "tokenFile"],
        accountStringKeys: ["botToken", "tokenFile"],
    },
    discord: {
        envAny: ["DISCORD_BOT_TOKEN"],
        stringKeys: ["token"],
        accountStringKeys: ["token"],
    },
    irc: {
        envAll: ["IRC_HOST", "IRC_NICK"],
        stringKeys: ["host", "nick"],
        accountStringKeys: ["host", "nick"],
    },
    slack: {
        envAny: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_USER_TOKEN"],
        stringKeys: ["botToken", "appToken", "userToken"],
        accountStringKeys: ["botToken", "appToken", "userToken"],
    },
    signal: {
        stringKeys: ["account", "httpUrl", "httpHost", "cliPath"],
        numberKeys: ["httpPort"],
        accountStringKeys: ["account", "httpUrl", "httpHost", "cliPath"],
    },
    imessage: {
        stringKeys: ["cliPath"],
    },
};
function envHasAnyKeys(env, keys) {
    for (const key of keys) {
        if (hasNonEmptyString(env[key])) {
            return true;
        }
    }
    return false;
}
function envHasAllKeys(env, keys) {
    for (const key of keys) {
        if (!hasNonEmptyString(env[key])) {
            return false;
        }
    }
    return keys.length > 0;
}
function hasAnyNumberKeys(entry, keys) {
    for (const key of keys) {
        if (typeof entry[key] === "number") {
            return true;
        }
    }
    return false;
}
function isStructuredChannelConfigured(cfg, channelId, env, spec) {
    if (spec.envAny && envHasAnyKeys(env, spec.envAny)) {
        return true;
    }
    if (spec.envAll && envHasAllKeys(env, spec.envAll)) {
        return true;
    }
    const entry = resolveChannelConfig(cfg, channelId);
    if (!entry) {
        return false;
    }
    if (spec.stringKeys && spec.stringKeys.some((key) => hasNonEmptyString(entry[key]))) {
        return true;
    }
    if (spec.numberKeys && hasAnyNumberKeys(entry, spec.numberKeys)) {
        return true;
    }
    if (spec.accountStringKeys && accountsHaveKeys(entry.accounts, spec.accountStringKeys)) {
        return true;
    }
    return hasMeaningfulChannelConfig(entry);
}
function isWhatsAppConfigured(cfg) {
    if (hasAnyWhatsAppAuth(cfg)) {
        return true;
    }
    const entry = resolveChannelConfig(cfg, "whatsapp");
    if (!entry) {
        return false;
    }
    return hasMeaningfulChannelConfig(entry);
}
function isGenericChannelConfigured(cfg, channelId) {
    const entry = resolveChannelConfig(cfg, channelId);
    return hasMeaningfulChannelConfig(entry);
}
export function isChannelConfigured(cfg, channelId, env = process.env) {
    if (channelId === "whatsapp") {
        return isWhatsAppConfigured(cfg);
    }
    const spec = STRUCTURED_CHANNEL_CONFIG_SPECS[channelId];
    if (spec) {
        return isStructuredChannelConfigured(cfg, channelId, env, spec);
    }
    return isGenericChannelConfigured(cfg, channelId);
}
