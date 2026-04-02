import { coerceSecretRef, resolveSecretInputRef } from "../config/types.secrets.js";
import { getMatrixScopedEnvVarNames } from "../plugin-sdk/matrix.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/account-id.js";
import { collectTtsApiKeyAssignments } from "./runtime-config-collectors-tts.js";
import { collectSecretInputAssignment, hasOwnProperty, isChannelAccountEffectivelyEnabled, isEnabledFlag, pushAssignment, pushInactiveSurfaceWarning, pushWarning, } from "./runtime-shared.js";
import { isRecord } from "./shared.js";
function getChannelRecord(config, channelKey) {
    const channels = config.channels;
    if (!isRecord(channels)) {
        return undefined;
    }
    const channel = channels[channelKey];
    return isRecord(channel) ? channel : undefined;
}
function getChannelSurface(config, channelKey) {
    const channel = getChannelRecord(config, channelKey);
    if (!channel) {
        return null;
    }
    return {
        channel,
        surface: resolveChannelAccountSurface(channel),
    };
}
function resolveChannelAccountSurface(channel) {
    const channelEnabled = isEnabledFlag(channel);
    const accounts = channel.accounts;
    if (!isRecord(accounts) || Object.keys(accounts).length === 0) {
        return {
            hasExplicitAccounts: false,
            channelEnabled,
            accounts: [{ accountId: "default", account: channel, enabled: channelEnabled }],
        };
    }
    const accountEntries = [];
    for (const [accountId, account] of Object.entries(accounts)) {
        if (!isRecord(account)) {
            continue;
        }
        accountEntries.push({
            accountId,
            account,
            enabled: isChannelAccountEffectivelyEnabled(channel, account),
        });
    }
    return {
        hasExplicitAccounts: true,
        channelEnabled,
        accounts: accountEntries,
    };
}
function isBaseFieldActiveForChannelSurface(surface, rootKey) {
    if (!surface.channelEnabled) {
        return false;
    }
    if (!surface.hasExplicitAccounts) {
        return true;
    }
    return surface.accounts.some(({ account, enabled }) => enabled && !hasOwnProperty(account, rootKey));
}
function normalizeSecretStringValue(value) {
    return typeof value === "string" ? value.trim() : "";
}
function hasConfiguredSecretInputValue(value, defaults) {
    return normalizeSecretStringValue(value).length > 0 || coerceSecretRef(value, defaults) !== null;
}
function collectSimpleChannelFieldAssignments(params) {
    collectSecretInputAssignment({
        value: params.channel[params.field],
        path: `channels.${params.channelKey}.${params.field}`,
        expected: "string",
        defaults: params.defaults,
        context: params.context,
        active: isBaseFieldActiveForChannelSurface(params.surface, params.field),
        inactiveReason: params.topInactiveReason,
        apply: (value) => {
            params.channel[params.field] = value;
        },
    });
    if (!params.surface.hasExplicitAccounts) {
        return;
    }
    for (const { accountId, account, enabled } of params.surface.accounts) {
        if (!hasOwnProperty(account, params.field)) {
            continue;
        }
        collectSecretInputAssignment({
            value: account[params.field],
            path: `channels.${params.channelKey}.accounts.${accountId}.${params.field}`,
            expected: "string",
            defaults: params.defaults,
            context: params.context,
            active: enabled,
            inactiveReason: params.accountInactiveReason,
            apply: (value) => {
                account[params.field] = value;
            },
        });
    }
}
function isConditionalTopLevelFieldActive(params) {
    if (!params.surface.channelEnabled) {
        return false;
    }
    if (!params.surface.hasExplicitAccounts) {
        return params.activeWithoutAccounts;
    }
    return params.surface.accounts.some(params.inheritedAccountActive);
}
function collectConditionalChannelFieldAssignments(params) {
    collectSecretInputAssignment({
        value: params.channel[params.field],
        path: `channels.${params.channelKey}.${params.field}`,
        expected: "string",
        defaults: params.defaults,
        context: params.context,
        active: isConditionalTopLevelFieldActive({
            surface: params.surface,
            activeWithoutAccounts: params.topLevelActiveWithoutAccounts,
            inheritedAccountActive: params.topLevelInheritedAccountActive,
        }),
        inactiveReason: params.topInactiveReason,
        apply: (value) => {
            params.channel[params.field] = value;
        },
    });
    if (!params.surface.hasExplicitAccounts) {
        return;
    }
    for (const entry of params.surface.accounts) {
        if (!hasOwnProperty(entry.account, params.field)) {
            continue;
        }
        collectSecretInputAssignment({
            value: entry.account[params.field],
            path: `channels.${params.channelKey}.accounts.${entry.accountId}.${params.field}`,
            expected: "string",
            defaults: params.defaults,
            context: params.context,
            active: params.accountActive(entry),
            inactiveReason: typeof params.accountInactiveReason === "function"
                ? params.accountInactiveReason(entry)
                : params.accountInactiveReason,
            apply: (value) => {
                entry.account[params.field] = value;
            },
        });
    }
}
function collectNestedChannelFieldAssignments(params) {
    const topLevelNested = params.channel[params.nestedKey];
    if (isRecord(topLevelNested)) {
        collectSecretInputAssignment({
            value: topLevelNested[params.field],
            path: `channels.${params.channelKey}.${params.nestedKey}.${params.field}`,
            expected: "string",
            defaults: params.defaults,
            context: params.context,
            active: params.topLevelActive,
            inactiveReason: params.topInactiveReason,
            apply: (value) => {
                topLevelNested[params.field] = value;
            },
        });
    }
    if (!params.surface.hasExplicitAccounts) {
        return;
    }
    for (const entry of params.surface.accounts) {
        const nested = entry.account[params.nestedKey];
        if (!isRecord(nested)) {
            continue;
        }
        collectSecretInputAssignment({
            value: nested[params.field],
            path: `channels.${params.channelKey}.accounts.${entry.accountId}.${params.nestedKey}.${params.field}`,
            expected: "string",
            defaults: params.defaults,
            context: params.context,
            active: params.accountActive(entry),
            inactiveReason: typeof params.accountInactiveReason === "function"
                ? params.accountInactiveReason(entry)
                : params.accountInactiveReason,
            apply: (value) => {
                nested[params.field] = value;
            },
        });
    }
}
function collectNestedChannelTtsAssignments(params) {
    const topLevelNested = params.channel[params.nestedKey];
    if (isRecord(topLevelNested) && isRecord(topLevelNested.tts)) {
        collectTtsApiKeyAssignments({
            tts: topLevelNested.tts,
            pathPrefix: `channels.${params.channelKey}.${params.nestedKey}.tts`,
            defaults: params.defaults,
            context: params.context,
            active: params.topLevelActive,
            inactiveReason: params.topInactiveReason,
        });
    }
    if (!params.surface.hasExplicitAccounts) {
        return;
    }
    for (const entry of params.surface.accounts) {
        const nested = entry.account[params.nestedKey];
        if (!isRecord(nested) || !isRecord(nested.tts)) {
            continue;
        }
        collectTtsApiKeyAssignments({
            tts: nested.tts,
            pathPrefix: `channels.${params.channelKey}.accounts.${entry.accountId}.${params.nestedKey}.tts`,
            defaults: params.defaults,
            context: params.context,
            active: params.accountActive(entry),
            inactiveReason: typeof params.accountInactiveReason === "function"
                ? params.accountInactiveReason(entry)
                : params.accountInactiveReason,
        });
    }
}
function collectTelegramAssignments(params) {
    const resolved = getChannelSurface(params.config, "telegram");
    if (!resolved) {
        return;
    }
    const { channel: telegram, surface } = resolved;
    const baseTokenFile = typeof telegram.tokenFile === "string" ? telegram.tokenFile.trim() : "";
    const accountTokenFile = (account) => typeof account.tokenFile === "string" ? account.tokenFile.trim() : "";
    collectConditionalChannelFieldAssignments({
        channelKey: "telegram",
        field: "botToken",
        channel: telegram,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: baseTokenFile.length === 0,
        topLevelInheritedAccountActive: ({ account, enabled }) => {
            if (!enabled || baseTokenFile.length > 0) {
                return false;
            }
            const accountBotTokenConfigured = hasConfiguredSecretInputValue(account.botToken, params.defaults);
            return !accountBotTokenConfigured && accountTokenFile(account).length === 0;
        },
        accountActive: ({ account, enabled }) => enabled && accountTokenFile(account).length === 0,
        topInactiveReason: "no enabled Telegram surface inherits this top-level botToken (tokenFile is configured).",
        accountInactiveReason: "Telegram account is disabled or tokenFile is configured.",
    });
    const baseWebhookUrl = typeof telegram.webhookUrl === "string" ? telegram.webhookUrl.trim() : "";
    const accountWebhookUrl = (account) => hasOwnProperty(account, "webhookUrl")
        ? typeof account.webhookUrl === "string"
            ? account.webhookUrl.trim()
            : ""
        : baseWebhookUrl;
    collectConditionalChannelFieldAssignments({
        channelKey: "telegram",
        field: "webhookSecret",
        channel: telegram,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: baseWebhookUrl.length > 0,
        topLevelInheritedAccountActive: ({ account, enabled }) => enabled && !hasOwnProperty(account, "webhookSecret") && accountWebhookUrl(account).length > 0,
        accountActive: ({ account, enabled }) => enabled && accountWebhookUrl(account).length > 0,
        topInactiveReason: "no enabled Telegram webhook surface inherits this top-level webhookSecret (webhook mode is not active).",
        accountInactiveReason: "Telegram account is disabled or webhook mode is not active for this account.",
    });
}
function collectSlackAssignments(params) {
    const resolved = getChannelSurface(params.config, "slack");
    if (!resolved) {
        return;
    }
    const { channel: slack, surface } = resolved;
    const baseMode = slack.mode === "http" || slack.mode === "socket" ? slack.mode : "socket";
    const fields = ["botToken", "userToken"];
    for (const field of fields) {
        collectSimpleChannelFieldAssignments({
            channelKey: "slack",
            field,
            channel: slack,
            surface,
            defaults: params.defaults,
            context: params.context,
            topInactiveReason: `no enabled account inherits this top-level Slack ${field}.`,
            accountInactiveReason: "Slack account is disabled.",
        });
    }
    const resolveAccountMode = (account) => account.mode === "http" || account.mode === "socket" ? account.mode : baseMode;
    collectConditionalChannelFieldAssignments({
        channelKey: "slack",
        field: "appToken",
        channel: slack,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: baseMode !== "http",
        topLevelInheritedAccountActive: ({ account, enabled }) => enabled && !hasOwnProperty(account, "appToken") && resolveAccountMode(account) !== "http",
        accountActive: ({ account, enabled }) => enabled && resolveAccountMode(account) !== "http",
        topInactiveReason: "no enabled Slack socket-mode surface inherits this top-level appToken.",
        accountInactiveReason: "Slack account is disabled or not running in socket mode.",
    });
    collectConditionalChannelFieldAssignments({
        channelKey: "slack",
        field: "signingSecret",
        channel: slack,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: baseMode === "http",
        topLevelInheritedAccountActive: ({ account, enabled }) => enabled &&
            !hasOwnProperty(account, "signingSecret") &&
            resolveAccountMode(account) === "http",
        accountActive: ({ account, enabled }) => enabled && resolveAccountMode(account) === "http",
        topInactiveReason: "no enabled Slack HTTP-mode surface inherits this top-level signingSecret.",
        accountInactiveReason: "Slack account is disabled or not running in HTTP mode.",
    });
}
function collectDiscordAssignments(params) {
    const resolved = getChannelSurface(params.config, "discord");
    if (!resolved) {
        return;
    }
    const { channel: discord, surface } = resolved;
    collectSimpleChannelFieldAssignments({
        channelKey: "discord",
        field: "token",
        channel: discord,
        surface,
        defaults: params.defaults,
        context: params.context,
        topInactiveReason: "no enabled account inherits this top-level Discord token.",
        accountInactiveReason: "Discord account is disabled.",
    });
    collectNestedChannelFieldAssignments({
        channelKey: "discord",
        nestedKey: "pluralkit",
        field: "token",
        channel: discord,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActive: isBaseFieldActiveForChannelSurface(surface, "pluralkit") &&
            isRecord(discord.pluralkit) &&
            isEnabledFlag(discord.pluralkit),
        topInactiveReason: "no enabled Discord surface inherits this top-level PluralKit config or PluralKit is disabled.",
        accountActive: ({ account, enabled }) => enabled && isRecord(account.pluralkit) && isEnabledFlag(account.pluralkit),
        accountInactiveReason: "Discord account is disabled or PluralKit is disabled for this account.",
    });
    collectNestedChannelTtsAssignments({
        channelKey: "discord",
        nestedKey: "voice",
        channel: discord,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActive: isBaseFieldActiveForChannelSurface(surface, "voice") &&
            isRecord(discord.voice) &&
            isEnabledFlag(discord.voice),
        topInactiveReason: "no enabled Discord surface inherits this top-level voice config or voice is disabled.",
        accountActive: ({ account, enabled }) => enabled && isRecord(account.voice) && isEnabledFlag(account.voice),
        accountInactiveReason: "Discord account is disabled or voice is disabled for this account.",
    });
}
function collectIrcAssignments(params) {
    const resolved = getChannelSurface(params.config, "irc");
    if (!resolved) {
        return;
    }
    const { channel: irc, surface } = resolved;
    collectSimpleChannelFieldAssignments({
        channelKey: "irc",
        field: "password",
        channel: irc,
        surface,
        defaults: params.defaults,
        context: params.context,
        topInactiveReason: "no enabled account inherits this top-level IRC password.",
        accountInactiveReason: "IRC account is disabled.",
    });
    collectNestedChannelFieldAssignments({
        channelKey: "irc",
        nestedKey: "nickserv",
        field: "password",
        channel: irc,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActive: isBaseFieldActiveForChannelSurface(surface, "nickserv") &&
            isRecord(irc.nickserv) &&
            isEnabledFlag(irc.nickserv),
        topInactiveReason: "no enabled account inherits this top-level IRC nickserv config or NickServ is disabled.",
        accountActive: ({ account, enabled }) => enabled && isRecord(account.nickserv) && isEnabledFlag(account.nickserv),
        accountInactiveReason: "IRC account is disabled or NickServ is disabled for this account.",
    });
}
function collectBlueBubblesAssignments(params) {
    const resolved = getChannelSurface(params.config, "bluebubbles");
    if (!resolved) {
        return;
    }
    const { channel: bluebubbles, surface } = resolved;
    collectSimpleChannelFieldAssignments({
        channelKey: "bluebubbles",
        field: "password",
        channel: bluebubbles,
        surface,
        defaults: params.defaults,
        context: params.context,
        topInactiveReason: "no enabled account inherits this top-level BlueBubbles password.",
        accountInactiveReason: "BlueBubbles account is disabled.",
    });
}
function collectMSTeamsAssignments(params) {
    const msteams = getChannelRecord(params.config, "msteams");
    if (!msteams) {
        return;
    }
    collectSecretInputAssignment({
        value: msteams.appPassword,
        path: "channels.msteams.appPassword",
        expected: "string",
        defaults: params.defaults,
        context: params.context,
        active: msteams.enabled !== false,
        inactiveReason: "Microsoft Teams channel is disabled.",
        apply: (value) => {
            msteams.appPassword = value;
        },
    });
}
function collectMattermostAssignments(params) {
    const resolved = getChannelSurface(params.config, "mattermost");
    if (!resolved) {
        return;
    }
    const { channel: mattermost, surface } = resolved;
    collectSimpleChannelFieldAssignments({
        channelKey: "mattermost",
        field: "botToken",
        channel: mattermost,
        surface,
        defaults: params.defaults,
        context: params.context,
        topInactiveReason: "no enabled account inherits this top-level Mattermost botToken.",
        accountInactiveReason: "Mattermost account is disabled.",
    });
}
function collectMatrixAssignments(params) {
    const resolved = getChannelSurface(params.config, "matrix");
    if (!resolved) {
        return;
    }
    const { channel: matrix, surface } = resolved;
    const envAccessTokenConfigured = normalizeSecretStringValue(params.context.env.MATRIX_ACCESS_TOKEN).length > 0;
    const defaultScopedAccessTokenConfigured = normalizeSecretStringValue(params.context.env[getMatrixScopedEnvVarNames("default").accessToken]).length > 0;
    const defaultAccountAccessTokenConfigured = surface.accounts.some(({ accountId, account }) => normalizeAccountId(accountId) === DEFAULT_ACCOUNT_ID &&
        hasConfiguredSecretInputValue(account.accessToken, params.defaults));
    const baseAccessTokenConfigured = hasConfiguredSecretInputValue(matrix.accessToken, params.defaults);
    collectSecretInputAssignment({
        value: matrix.accessToken,
        path: "channels.matrix.accessToken",
        expected: "string",
        defaults: params.defaults,
        context: params.context,
        active: surface.channelEnabled,
        inactiveReason: "Matrix channel is disabled.",
        apply: (value) => {
            matrix.accessToken = value;
        },
    });
    collectSecretInputAssignment({
        value: matrix.password,
        path: "channels.matrix.password",
        expected: "string",
        defaults: params.defaults,
        context: params.context,
        active: surface.channelEnabled &&
            !(baseAccessTokenConfigured ||
                envAccessTokenConfigured ||
                defaultScopedAccessTokenConfigured ||
                defaultAccountAccessTokenConfigured),
        inactiveReason: "Matrix channel is disabled or access-token auth is configured for the default Matrix account.",
        apply: (value) => {
            matrix.password = value;
        },
    });
    if (!surface.hasExplicitAccounts) {
        return;
    }
    for (const { accountId, account, enabled } of surface.accounts) {
        if (hasOwnProperty(account, "accessToken")) {
            collectSecretInputAssignment({
                value: account.accessToken,
                path: `channels.matrix.accounts.${accountId}.accessToken`,
                expected: "string",
                defaults: params.defaults,
                context: params.context,
                active: enabled,
                inactiveReason: "Matrix account is disabled.",
                apply: (value) => {
                    account.accessToken = value;
                },
            });
        }
        if (!hasOwnProperty(account, "password")) {
            continue;
        }
        const accountAccessTokenConfigured = hasConfiguredSecretInputValue(account.accessToken, params.defaults);
        const scopedEnvAccessTokenConfigured = normalizeSecretStringValue(params.context.env[getMatrixScopedEnvVarNames(accountId).accessToken]).length > 0;
        const inheritedDefaultAccountAccessTokenConfigured = normalizeAccountId(accountId) === DEFAULT_ACCOUNT_ID &&
            (baseAccessTokenConfigured || envAccessTokenConfigured);
        collectSecretInputAssignment({
            value: account.password,
            path: `channels.matrix.accounts.${accountId}.password`,
            expected: "string",
            defaults: params.defaults,
            context: params.context,
            active: enabled &&
                !(accountAccessTokenConfigured ||
                    scopedEnvAccessTokenConfigured ||
                    inheritedDefaultAccountAccessTokenConfigured),
            inactiveReason: "Matrix account is disabled or this account has an accessToken configured.",
            apply: (value) => {
                account.password = value;
            },
        });
    }
}
function collectZaloAssignments(params) {
    const resolved = getChannelSurface(params.config, "zalo");
    if (!resolved) {
        return;
    }
    const { channel: zalo, surface } = resolved;
    collectConditionalChannelFieldAssignments({
        channelKey: "zalo",
        field: "botToken",
        channel: zalo,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: true,
        topLevelInheritedAccountActive: ({ account, enabled }) => enabled && !hasOwnProperty(account, "botToken"),
        accountActive: ({ enabled }) => enabled,
        topInactiveReason: "no enabled Zalo surface inherits this top-level botToken.",
        accountInactiveReason: "Zalo account is disabled.",
    });
    const baseWebhookUrl = normalizeSecretStringValue(zalo.webhookUrl);
    const resolveAccountWebhookUrl = (account) => hasOwnProperty(account, "webhookUrl")
        ? normalizeSecretStringValue(account.webhookUrl)
        : baseWebhookUrl;
    collectConditionalChannelFieldAssignments({
        channelKey: "zalo",
        field: "webhookSecret",
        channel: zalo,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: baseWebhookUrl.length > 0,
        topLevelInheritedAccountActive: ({ account, enabled }) => enabled &&
            !hasOwnProperty(account, "webhookSecret") &&
            resolveAccountWebhookUrl(account).length > 0,
        accountActive: ({ account, enabled }) => enabled && resolveAccountWebhookUrl(account).length > 0,
        topInactiveReason: "no enabled Zalo webhook surface inherits this top-level webhookSecret (webhook mode is not active).",
        accountInactiveReason: "Zalo account is disabled or webhook mode is not active for this account.",
    });
}
function collectFeishuAssignments(params) {
    const resolved = getChannelSurface(params.config, "feishu");
    if (!resolved) {
        return;
    }
    const { channel: feishu, surface } = resolved;
    collectSimpleChannelFieldAssignments({
        channelKey: "feishu",
        field: "appSecret",
        channel: feishu,
        surface,
        defaults: params.defaults,
        context: params.context,
        topInactiveReason: "no enabled account inherits this top-level Feishu appSecret.",
        accountInactiveReason: "Feishu account is disabled.",
    });
    const baseConnectionMode = normalizeSecretStringValue(feishu.connectionMode) === "webhook" ? "webhook" : "websocket";
    const resolveAccountMode = (account) => hasOwnProperty(account, "connectionMode")
        ? normalizeSecretStringValue(account.connectionMode)
        : baseConnectionMode;
    collectConditionalChannelFieldAssignments({
        channelKey: "feishu",
        field: "encryptKey",
        channel: feishu,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: baseConnectionMode === "webhook",
        topLevelInheritedAccountActive: ({ account, enabled }) => enabled &&
            !hasOwnProperty(account, "encryptKey") &&
            resolveAccountMode(account) === "webhook",
        accountActive: ({ account, enabled }) => enabled && resolveAccountMode(account) === "webhook",
        topInactiveReason: "no enabled Feishu webhook-mode surface inherits this top-level encryptKey.",
        accountInactiveReason: "Feishu account is disabled or not running in webhook mode.",
    });
    collectConditionalChannelFieldAssignments({
        channelKey: "feishu",
        field: "verificationToken",
        channel: feishu,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: baseConnectionMode === "webhook",
        topLevelInheritedAccountActive: ({ account, enabled }) => enabled &&
            !hasOwnProperty(account, "verificationToken") &&
            resolveAccountMode(account) === "webhook",
        accountActive: ({ account, enabled }) => enabled && resolveAccountMode(account) === "webhook",
        topInactiveReason: "no enabled Feishu webhook-mode surface inherits this top-level verificationToken.",
        accountInactiveReason: "Feishu account is disabled or not running in webhook mode.",
    });
}
function collectNextcloudTalkAssignments(params) {
    const resolved = getChannelSurface(params.config, "nextcloud-talk");
    if (!resolved) {
        return;
    }
    const { channel: nextcloudTalk, surface } = resolved;
    const inheritsField = (field) => ({ account, enabled }) => enabled && !hasOwnProperty(account, field);
    collectConditionalChannelFieldAssignments({
        channelKey: "nextcloud-talk",
        field: "botSecret",
        channel: nextcloudTalk,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: true,
        topLevelInheritedAccountActive: inheritsField("botSecret"),
        accountActive: ({ enabled }) => enabled,
        topInactiveReason: "no enabled Nextcloud Talk surface inherits this top-level botSecret.",
        accountInactiveReason: "Nextcloud Talk account is disabled.",
    });
    collectConditionalChannelFieldAssignments({
        channelKey: "nextcloud-talk",
        field: "apiPassword",
        channel: nextcloudTalk,
        surface,
        defaults: params.defaults,
        context: params.context,
        topLevelActiveWithoutAccounts: true,
        topLevelInheritedAccountActive: inheritsField("apiPassword"),
        accountActive: ({ enabled }) => enabled,
        topInactiveReason: "no enabled Nextcloud Talk surface inherits this top-level apiPassword.",
        accountInactiveReason: "Nextcloud Talk account is disabled.",
    });
}
function collectGoogleChatAccountAssignment(params) {
    const { explicitRef, ref } = resolveSecretInputRef({
        value: params.target.serviceAccount,
        refValue: params.target.serviceAccountRef,
        defaults: params.defaults,
    });
    if (!ref) {
        return;
    }
    if (params.active === false) {
        pushInactiveSurfaceWarning({
            context: params.context,
            path: `${params.path}.serviceAccount`,
            details: params.inactiveReason,
        });
        return;
    }
    if (explicitRef &&
        params.target.serviceAccount !== undefined &&
        !coerceSecretRef(params.target.serviceAccount, params.defaults)) {
        pushWarning(params.context, {
            code: "SECRETS_REF_OVERRIDES_PLAINTEXT",
            path: params.path,
            message: `${params.path}: serviceAccountRef is set; runtime will ignore plaintext serviceAccount.`,
        });
    }
    pushAssignment(params.context, {
        ref,
        path: `${params.path}.serviceAccount`,
        expected: "string-or-object",
        apply: (value) => {
            params.target.serviceAccount = value;
        },
    });
}
function collectGoogleChatAssignments(params) {
    const googleChatRecord = params.googleChat;
    const surface = resolveChannelAccountSurface(googleChatRecord);
    const topLevelServiceAccountActive = !surface.channelEnabled
        ? false
        : !surface.hasExplicitAccounts
            ? true
            : surface.accounts.some(({ account, enabled }) => enabled &&
                !hasOwnProperty(account, "serviceAccount") &&
                !hasOwnProperty(account, "serviceAccountRef"));
    collectGoogleChatAccountAssignment({
        target: params.googleChat,
        path: "channels.googlechat",
        defaults: params.defaults,
        context: params.context,
        active: topLevelServiceAccountActive,
        inactiveReason: "no enabled account inherits this top-level Google Chat serviceAccount.",
    });
    if (!surface.hasExplicitAccounts) {
        return;
    }
    for (const { accountId, account, enabled } of surface.accounts) {
        if (!hasOwnProperty(account, "serviceAccount") &&
            !hasOwnProperty(account, "serviceAccountRef")) {
            continue;
        }
        collectGoogleChatAccountAssignment({
            target: account,
            path: `channels.googlechat.accounts.${accountId}`,
            defaults: params.defaults,
            context: params.context,
            active: enabled,
            inactiveReason: "Google Chat account is disabled.",
        });
    }
}
export function collectChannelConfigAssignments(params) {
    const googleChat = getChannelRecord(params.config, "googlechat");
    if (googleChat) {
        collectGoogleChatAssignments({
            googleChat,
            defaults: params.defaults,
            context: params.context,
        });
    }
    collectTelegramAssignments(params);
    collectSlackAssignments(params);
    collectDiscordAssignments(params);
    collectIrcAssignments(params);
    collectBlueBubblesAssignments(params);
    collectMattermostAssignments(params);
    collectMatrixAssignments(params);
    collectMSTeamsAssignments(params);
    collectNextcloudTalkAssignments(params);
    collectFeishuAssignments(params);
    collectZaloAssignments(params);
}
