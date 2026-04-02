import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { adaptScopedAccountAccessor, createScopedChannelConfigAdapter, } from "openclaw/plugin-sdk/channel-config-helpers";
import { createRestrictSendersChannelSecurity } from "openclaw/plugin-sdk/channel-policy";
import { createChannelPluginBase } from "openclaw/plugin-sdk/core";
import { normalizeE164 } from "openclaw/plugin-sdk/text-runtime";
import { listSignalAccountIds, resolveDefaultSignalAccountId, resolveSignalAccount, } from "./accounts.js";
import { SignalChannelConfigSchema } from "./config-schema.js";
import { getChatChannelMeta } from "./runtime-api.js";
import { createSignalSetupWizardProxy } from "./setup-core.js";
export const SIGNAL_CHANNEL = "signal";
async function loadSignalChannelRuntime() {
    return await import("./channel.runtime.js");
}
export const signalSetupWizard = createSignalSetupWizardProxy(async () => (await loadSignalChannelRuntime()).signalSetupWizard);
export const signalConfigAdapter = createScopedChannelConfigAdapter({
    sectionKey: SIGNAL_CHANNEL,
    listAccountIds: (cfg) => listSignalAccountIds(cfg),
    resolveAccount: adaptScopedAccountAccessor((params) => resolveSignalAccount(params)),
    defaultAccountId: (cfg) => resolveDefaultSignalAccountId(cfg),
    clearBaseFields: ["account", "httpUrl", "httpHost", "httpPort", "cliPath", "name"],
    resolveAllowFrom: (account) => account.config.allowFrom,
    formatAllowFrom: (allowFrom) => allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => (entry === "*" ? "*" : normalizeE164(entry.replace(/^signal:/i, ""))))
        .filter(Boolean),
    resolveDefaultTo: (account) => account.config.defaultTo,
});
export const signalSecurityAdapter = createRestrictSendersChannelSecurity({
    channelKey: SIGNAL_CHANNEL,
    resolveDmPolicy: (account) => account.config.dmPolicy,
    resolveDmAllowFrom: (account) => account.config.allowFrom,
    resolveGroupPolicy: (account) => account.config.groupPolicy,
    surface: "Signal groups",
    openScope: "any member",
    groupPolicyPath: "channels.signal.groupPolicy",
    groupAllowFromPath: "channels.signal.groupAllowFrom",
    mentionGated: false,
    policyPathSuffix: "dmPolicy",
    normalizeDmEntry: (raw) => normalizeE164(raw.replace(/^signal:/i, "").trim()),
});
export function createSignalPluginBase(params) {
    return createChannelPluginBase({
        id: SIGNAL_CHANNEL,
        meta: {
            ...getChatChannelMeta(SIGNAL_CHANNEL),
        },
        setupWizard: params.setupWizard,
        capabilities: {
            chatTypes: ["direct", "group"],
            media: true,
            reactions: true,
        },
        streaming: {
            blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
        },
        reload: { configPrefixes: ["channels.signal"] },
        configSchema: SignalChannelConfigSchema,
        config: {
            ...signalConfigAdapter,
            isConfigured: (account) => account.configured,
            describeAccount: (account) => describeAccountSnapshot({
                account,
                configured: account.configured,
                extra: {
                    baseUrl: account.baseUrl,
                },
            }),
        },
        security: signalSecurityAdapter,
        setup: params.setup,
    });
}
