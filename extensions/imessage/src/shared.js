import { describeAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { adaptScopedAccountAccessor, createScopedChannelConfigAdapter, formatTrimmedAllowFromEntries, } from "openclaw/plugin-sdk/channel-config-helpers";
import { createRestrictSendersChannelSecurity } from "openclaw/plugin-sdk/channel-policy";
import { createChannelPluginBase } from "openclaw/plugin-sdk/core";
import { getChatChannelMeta } from "../runtime-api.js";
import { listIMessageAccountIds, resolveDefaultIMessageAccountId, resolveIMessageAccount, } from "./accounts.js";
import { IMessageChannelConfigSchema } from "./config-schema.js";
import { createIMessageSetupWizardProxy } from "./setup-core.js";
export const IMESSAGE_CHANNEL = "imessage";
async function loadIMessageChannelRuntime() {
    return await import("./channel.runtime.js");
}
export const imessageSetupWizard = createIMessageSetupWizardProxy(async () => (await loadIMessageChannelRuntime()).imessageSetupWizard);
export const imessageConfigAdapter = createScopedChannelConfigAdapter({
    sectionKey: IMESSAGE_CHANNEL,
    listAccountIds: listIMessageAccountIds,
    resolveAccount: adaptScopedAccountAccessor(resolveIMessageAccount),
    defaultAccountId: resolveDefaultIMessageAccountId,
    clearBaseFields: ["cliPath", "dbPath", "service", "region", "name"],
    resolveAllowFrom: (account) => account.config.allowFrom,
    formatAllowFrom: (allowFrom) => formatTrimmedAllowFromEntries(allowFrom),
    resolveDefaultTo: (account) => account.config.defaultTo,
});
export const imessageSecurityAdapter = createRestrictSendersChannelSecurity({
    channelKey: IMESSAGE_CHANNEL,
    resolveDmPolicy: (account) => account.config.dmPolicy,
    resolveDmAllowFrom: (account) => account.config.allowFrom,
    resolveGroupPolicy: (account) => account.config.groupPolicy,
    surface: "iMessage groups",
    openScope: "any member",
    groupPolicyPath: "channels.imessage.groupPolicy",
    groupAllowFromPath: "channels.imessage.groupAllowFrom",
    mentionGated: false,
    policyPathSuffix: "dmPolicy",
});
export function createIMessagePluginBase(params) {
    return createChannelPluginBase({
        id: IMESSAGE_CHANNEL,
        meta: {
            ...getChatChannelMeta(IMESSAGE_CHANNEL),
            aliases: ["imsg"],
            showConfigured: false,
        },
        setupWizard: params.setupWizard,
        capabilities: {
            chatTypes: ["direct", "group"],
            media: true,
        },
        reload: { configPrefixes: ["channels.imessage"] },
        configSchema: IMessageChannelConfigSchema,
        config: {
            ...imessageConfigAdapter,
            isConfigured: (account) => account.configured,
            describeAccount: (account) => describeAccountSnapshot({
                account,
                configured: account.configured,
            }),
        },
        security: imessageSecurityAdapter,
        setup: params.setup,
    });
}
