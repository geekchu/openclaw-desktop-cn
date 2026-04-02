import { adaptScopedAccountAccessor } from "openclaw/plugin-sdk/channel-config-helpers";
import { noteChannelLookupFailure, noteChannelLookupSummary, resolveEntriesWithOptionalToken, parseMentionOrPrefixedId, promptLegacyChannelAllowFromForAccount, } from "openclaw/plugin-sdk/setup";
import { formatDocsLink } from "openclaw/plugin-sdk/setup-tools";
import { resolveDefaultSlackAccountId, resolveSlackAccount, } from "./accounts.js";
import { resolveSlackChannelAllowlist } from "./resolve-channels.js";
import { resolveSlackUserAllowlist } from "./resolve-users.js";
import { createSlackSetupWizardBase } from "./setup-core.js";
import { SLACK_CHANNEL as channel } from "./shared.js";
async function resolveSlackAllowFromEntries(params) {
    return await resolveEntriesWithOptionalToken({
        token: params.token,
        entries: params.entries,
        buildWithoutToken: (input) => ({
            input,
            resolved: false,
            id: null,
        }),
        resolveEntries: async ({ token, entries }) => (await resolveSlackUserAllowlist({
            token,
            entries,
        })).map((entry) => ({
            input: entry.input,
            resolved: entry.resolved,
            id: entry.id ?? null,
        })),
    });
}
async function promptSlackAllowFrom(params) {
    const parseId = (value) => parseMentionOrPrefixedId({
        value,
        mentionPattern: /^<@([A-Z0-9]+)>$/i,
        prefixPattern: /^(slack:|user:)/i,
        idPattern: /^[A-Z][A-Z0-9]+$/i,
        normalizeId: (id) => id.toUpperCase(),
    });
    return await promptLegacyChannelAllowFromForAccount({
        cfg: params.cfg,
        channel,
        prompter: params.prompter,
        accountId: params.accountId,
        defaultAccountId: resolveDefaultSlackAccountId(params.cfg),
        resolveAccount: adaptScopedAccountAccessor(resolveSlackAccount),
        resolveExisting: (_account, cfg) => cfg.channels?.slack?.allowFrom ?? cfg.channels?.slack?.dm?.allowFrom ?? [],
        resolveToken: (account) => account.userToken ?? account.botToken ?? "",
        noteTitle: "Slack allowlist",
        noteLines: [
            "Allowlist Slack DMs by username (we resolve to user ids).",
            "Examples:",
            "- U12345678",
            "- @alice",
            "Multiple entries: comma-separated.",
            `Docs: ${formatDocsLink("/slack", "slack")}`,
        ],
        message: "Slack allowFrom (usernames or ids)",
        placeholder: "@alice, U12345678",
        parseId,
        invalidWithoutTokenNote: "Slack token missing; use user ids (or mention form) only.",
        resolveEntries: async ({ token, entries }) => (await resolveSlackUserAllowlist({
            token,
            entries,
        })).map((entry) => ({
            input: entry.input,
            resolved: entry.resolved,
            id: entry.id ?? null,
        })),
    });
}
async function resolveSlackGroupAllowlist(params) {
    let keys = params.entries;
    const accountWithTokens = resolveSlackAccount({
        cfg: params.cfg,
        accountId: params.accountId,
    });
    const activeBotToken = accountWithTokens.botToken || params.credentialValues.botToken || "";
    if (params.entries.length > 0) {
        try {
            const resolved = await resolveEntriesWithOptionalToken({
                token: activeBotToken,
                entries: params.entries,
                buildWithoutToken: (input) => ({ input, resolved: false, id: undefined }),
                resolveEntries: async ({ token, entries }) => await resolveSlackChannelAllowlist({
                    token,
                    entries,
                }),
            });
            const resolvedKeys = resolved
                .filter((entry) => entry.resolved && entry.id)
                .map((entry) => entry.id);
            const unresolved = resolved.filter((entry) => !entry.resolved).map((entry) => entry.input);
            keys = [...resolvedKeys, ...unresolved.map((entry) => entry.trim()).filter(Boolean)];
            await noteChannelLookupSummary({
                prompter: params.prompter,
                label: "Slack channels",
                resolvedSections: [{ title: "Resolved", values: resolvedKeys }],
                unresolved,
            });
        }
        catch (error) {
            await noteChannelLookupFailure({
                prompter: params.prompter,
                label: "Slack channels",
                error,
            });
        }
    }
    return keys;
}
export const slackSetupWizard = createSlackSetupWizardBase({
    promptAllowFrom: promptSlackAllowFrom,
    resolveAllowFromEntries: async ({ credentialValues, entries }) => await resolveSlackAllowFromEntries({
        token: credentialValues.botToken,
        entries,
    }),
    resolveGroupAllowlist: async ({ cfg, accountId, credentialValues, entries, prompter }) => await resolveSlackGroupAllowlist({
        cfg,
        accountId,
        credentialValues,
        entries,
        prompter,
    }),
});
