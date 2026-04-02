import { resolveMergedAccountConfig } from "../channels/plugins/account-helpers.js";
import { deleteAccountFromConfigSection as deleteAccountFromConfigSectionInSection, setAccountEnabledInConfigSection as setAccountEnabledInConfigSectionInSection, } from "../channels/plugins/config-helpers.js";
import { formatCliCommand } from "../cli/command-format.js";
import { resolveAccountEntry } from "../routing/account-lookup.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import { normalizeStringEntries } from "../shared/string-normalization.js";
const WHATSAPP_USER_JID_RE = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/i;
const WHATSAPP_LID_RE = /^(\d+)@lid$/i;
const INTERNAL_MESSAGE_CHANNEL = "webchat";
function formatPairingApproveHint(channelId) {
    const listCmd = formatCliCommand(`openclaw pairing list ${channelId}`);
    const approveCmd = formatCliCommand(`openclaw pairing approve ${channelId} <code>`);
    return `Approve via: ${listCmd} / ${approveCmd}`;
}
function buildAccountScopedDmSecurityPolicy(params) {
    const resolvedAccountId = params.accountId ?? params.fallbackAccountId ?? DEFAULT_ACCOUNT_ID;
    const channelConfig = params.cfg.channels?.[params.channelKey];
    const useAccountPath = Boolean(channelConfig?.accounts?.[resolvedAccountId]);
    const basePath = useAccountPath
        ? `channels.${params.channelKey}.accounts.${resolvedAccountId}.`
        : `channels.${params.channelKey}.`;
    const allowFromPath = `${basePath}${params.allowFromPathSuffix ?? ""}`;
    const policyPath = params.policyPathSuffix != null ? `${basePath}${params.policyPathSuffix}` : undefined;
    return {
        policy: params.policy ?? params.defaultPolicy ?? "pairing",
        allowFrom: params.allowFrom ?? [],
        policyPath,
        allowFromPath,
        approveHint: params.approveHint ?? formatPairingApproveHint(params.approveChannelId ?? params.channelKey),
        normalizeEntry: params.normalizeEntry,
    };
}
function normalizeLocalE164(number) {
    const withoutPrefix = number.replace(/^whatsapp:/i, "").trim();
    const digits = withoutPrefix.replace(/[^\d+]/g, "");
    if (digits.startsWith("+")) {
        return `+${digits.slice(1)}`;
    }
    return `+${digits}`;
}
function stripWhatsAppTargetPrefixes(value) {
    let candidate = value.trim();
    for (;;) {
        const before = candidate;
        candidate = candidate.replace(/^whatsapp:/i, "").trim();
        if (candidate === before) {
            return candidate;
        }
    }
}
function normalizeLocalWhatsAppTarget(value) {
    const candidate = stripWhatsAppTargetPrefixes(value);
    if (!candidate) {
        return null;
    }
    if (candidate.toLowerCase().endsWith("@g.us")) {
        const localPart = candidate.slice(0, candidate.length - "@g.us".length);
        return /^[0-9]+(-[0-9]+)*$/.test(localPart) ? `${localPart}@g.us` : null;
    }
    const userMatch = candidate.match(WHATSAPP_USER_JID_RE);
    const lidMatch = candidate.match(WHATSAPP_LID_RE);
    const phone = userMatch?.[1] ?? lidMatch?.[1];
    if (phone) {
        const normalized = normalizeLocalE164(phone);
        return normalized.length > 1 ? normalized : null;
    }
    if (candidate.includes("@")) {
        return null;
    }
    const normalized = normalizeLocalE164(candidate);
    return normalized.length > 1 ? normalized : null;
}
function resolveChannelConfig(cfg, channelId) {
    if (!channelId) {
        return undefined;
    }
    return cfg.channels?.[channelId];
}
function resolveChannelAccountConfig(channelConfig, accountId) {
    return resolveAccountEntry(channelConfig.accounts, normalizeAccountId(accountId));
}
function listConfigWriteTargetScopes(target) {
    if (!target || target.kind === "global") {
        return [];
    }
    if (target.kind === "ambiguous") {
        return target.scopes;
    }
    return [target.scope];
}
export function resolveChannelConfigWrites(params) {
    const channelConfig = resolveChannelConfig(params.cfg, params.channelId);
    if (!channelConfig) {
        return true;
    }
    const accountConfig = resolveChannelAccountConfig(channelConfig, params.accountId);
    const value = accountConfig?.configWrites ?? channelConfig.configWrites;
    return value !== false;
}
export function authorizeConfigWrite(params) {
    if (params.allowBypass) {
        return { allowed: true };
    }
    if (params.target?.kind === "ambiguous") {
        return { allowed: false, reason: "ambiguous-target" };
    }
    if (params.origin?.channelId &&
        !resolveChannelConfigWrites({
            cfg: params.cfg,
            channelId: params.origin.channelId,
            accountId: params.origin.accountId,
        })) {
        return {
            allowed: false,
            reason: "origin-disabled",
            blockedScope: { kind: "origin", scope: params.origin },
        };
    }
    const seen = new Set();
    for (const target of listConfigWriteTargetScopes(params.target)) {
        if (!target.channelId) {
            continue;
        }
        const key = `${target.channelId}:${normalizeAccountId(target.accountId)}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        if (!resolveChannelConfigWrites({
            cfg: params.cfg,
            channelId: target.channelId,
            accountId: target.accountId,
        })) {
            return {
                allowed: false,
                reason: "target-disabled",
                blockedScope: { kind: "target", scope: target },
            };
        }
    }
    return { allowed: true };
}
export function canBypassConfigWritePolicy(params) {
    return (params.channel?.trim().toLowerCase() === INTERNAL_MESSAGE_CHANNEL &&
        params.gatewayClientScopes?.includes("operator.admin") === true);
}
export function formatConfigWriteDeniedMessage(params) {
    if (params.result.reason === "ambiguous-target") {
        return "⚠️ Channel-initiated /config writes cannot replace channels, channel roots, or accounts collections. Use a more specific path or gateway operator.admin.";
    }
    const blocked = params.result.blockedScope?.scope;
    const channelLabel = blocked?.channelId ?? params.fallbackChannelId ?? "this channel";
    const hint = blocked?.channelId
        ? blocked.accountId
            ? `channels.${blocked.channelId}.accounts.${blocked.accountId}.configWrites=true`
            : `channels.${blocked.channelId}.configWrites=true`
        : params.fallbackChannelId
            ? `channels.${params.fallbackChannelId}.configWrites=true`
            : "channels.<channel>.configWrites=true";
    return `⚠️ Config writes are disabled for ${channelLabel}. Set ${hint} to enable.`;
}
/** Coerce mixed allowlist config values into plain strings without trimming or deduping. */
export function mapAllowFromEntries(allowFrom) {
    return (allowFrom ?? []).map((entry) => String(entry));
}
/** Normalize user-facing allowlist entries the same way config and doctor flows expect. */
export function formatTrimmedAllowFromEntries(allowFrom) {
    return normalizeStringEntries(allowFrom);
}
/** Collapse nullable config scalars into a trimmed optional string. */
export function resolveOptionalConfigString(value) {
    if (value == null) {
        return undefined;
    }
    const normalized = String(value).trim();
    return normalized || undefined;
}
/** Adapt `{ cfg, accountId }` accessors to callback sites that pass positional args. */
export function adaptScopedAccountAccessor(accessor) {
    return (cfg, accountId) => accessor({ cfg, accountId });
}
/** Build the shared allowlist/default target adapter surface for account-scoped channel configs. */
export function createScopedAccountConfigAccessors(params) {
    const base = {
        resolveAllowFrom({ cfg, accountId }) {
            return mapAllowFromEntries(params.resolveAllowFrom(params.resolveAccount({ cfg: cfg, accountId })));
        },
        formatAllowFrom({ allowFrom }) {
            return params.formatAllowFrom(allowFrom);
        },
    };
    if (!params.resolveDefaultTo) {
        return base;
    }
    return {
        ...base,
        resolveDefaultTo({ cfg, accountId }) {
            return resolveOptionalConfigString(params.resolveDefaultTo?.(params.resolveAccount({ cfg: cfg, accountId })));
        },
    };
}
function createNamedAccountConfigBase(params) {
    return {
        listAccountIds(cfg) {
            return params.listAccountIds(cfg);
        },
        resolveAccount(cfg, accountId) {
            return params.resolveAccount(cfg, accountId);
        },
        inspectAccount: params.inspectAccount
            ? (cfg, accountId) => params.inspectAccount?.(cfg, accountId)
            : undefined,
        defaultAccountId(cfg) {
            return params.defaultAccountId(cfg);
        },
        setAccountEnabled({ cfg, accountId, enabled }) {
            return params.setAccountEnabled({
                cfg,
                accountId: normalizeAccountId(accountId),
                enabled,
            });
        },
        deleteAccount({ cfg, accountId }) {
            return params.deleteAccount({
                cfg,
                accountId: normalizeAccountId(accountId),
            });
        },
    };
}
function resolveAccessorAccountWithFallback(resolveAccessorAccount, fallbackResolveAccessorAccount) {
    return resolveAccessorAccount ?? fallbackResolveAccessorAccount;
}
function createChannelConfigAdapterWithAccessors(params) {
    return {
        ...params.base,
        ...createScopedAccountConfigAccessors({
            resolveAccount: resolveAccessorAccountWithFallback(params.resolveAccessorAccount, params.fallbackResolveAccessorAccount),
            resolveAllowFrom: params.resolveAllowFrom,
            formatAllowFrom: params.formatAllowFrom,
            resolveDefaultTo: params.resolveDefaultTo,
        }),
    };
}
function createChannelConfigAdapterFromBase(params) {
    return createChannelConfigAdapterWithAccessors({
        base: params.base,
        resolveAccessorAccount: params.resolveAccessorAccount,
        fallbackResolveAccessorAccount: params.resolveAccountForAccessors,
        resolveAllowFrom: params.resolveAllowFrom,
        formatAllowFrom: params.formatAllowFrom,
        resolveDefaultTo: params.resolveDefaultTo,
    });
}
/** Build the common CRUD/config helpers for channels that store multiple named accounts. */
export function createScopedChannelConfigBase(params) {
    return createNamedAccountConfigBase({
        listAccountIds: params.listAccountIds,
        resolveAccount: params.resolveAccount,
        inspectAccount: params.inspectAccount,
        defaultAccountId: params.defaultAccountId,
        setAccountEnabled({ cfg, accountId, enabled }) {
            return setAccountEnabledInConfigSectionInSection({
                cfg,
                sectionKey: params.sectionKey,
                accountId,
                enabled,
                allowTopLevel: params.allowTopLevel ?? true,
            });
        },
        deleteAccount({ cfg, accountId }) {
            return deleteAccountFromConfigSectionInSection({
                cfg,
                sectionKey: params.sectionKey,
                accountId,
                clearBaseFields: params.clearBaseFields,
            });
        },
    });
}
/** Build the full shared config adapter for account-scoped channels with allowlist/default target accessors. */
export function createScopedChannelConfigAdapter(params) {
    return createChannelConfigAdapterFromBase({
        base: createScopedChannelConfigBase({
            sectionKey: params.sectionKey,
            listAccountIds: params.listAccountIds,
            resolveAccount: params.resolveAccount,
            inspectAccount: params.inspectAccount,
            defaultAccountId: params.defaultAccountId,
            clearBaseFields: params.clearBaseFields,
            allowTopLevel: params.allowTopLevel,
        }),
        resolveAccessorAccount: params.resolveAccessorAccount,
        resolveAccountForAccessors({ cfg, accountId }) {
            return params.resolveAccount(cfg, accountId);
        },
        resolveAllowFrom: params.resolveAllowFrom,
        formatAllowFrom: params.formatAllowFrom,
        resolveDefaultTo: params.resolveDefaultTo,
    });
}
function setTopLevelChannelEnabledInConfigSection(params) {
    const section = params.cfg.channels?.[params.sectionKey];
    return {
        ...params.cfg,
        channels: {
            ...params.cfg.channels,
            [params.sectionKey]: {
                ...section,
                enabled: params.enabled,
            },
        },
    };
}
function removeTopLevelChannelConfigSection(params) {
    const nextChannels = { ...params.cfg.channels };
    delete nextChannels[params.sectionKey];
    const nextCfg = { ...params.cfg };
    if (Object.keys(nextChannels).length > 0) {
        nextCfg.channels = nextChannels;
    }
    else {
        delete nextCfg.channels;
    }
    return nextCfg;
}
function clearTopLevelChannelConfigFields(params) {
    const section = params.cfg.channels?.[params.sectionKey];
    if (!section) {
        return params.cfg;
    }
    const nextSection = { ...section };
    for (const field of params.clearBaseFields) {
        delete nextSection[field];
    }
    return {
        ...params.cfg,
        channels: {
            ...params.cfg.channels,
            [params.sectionKey]: nextSection,
        },
    };
}
/** Build CRUD/config helpers for top-level single-account channels. */
export function createTopLevelChannelConfigBase(params) {
    return {
        listAccountIds(cfg) {
            return params.listAccountIds?.(cfg) ?? [DEFAULT_ACCOUNT_ID];
        },
        resolveAccount(cfg) {
            return params.resolveAccount(cfg);
        },
        inspectAccount: params.inspectAccount
            ? (cfg) => params.inspectAccount?.(cfg)
            : undefined,
        defaultAccountId(cfg) {
            return params.defaultAccountId?.(cfg) ?? DEFAULT_ACCOUNT_ID;
        },
        setAccountEnabled({ cfg, enabled }) {
            return setTopLevelChannelEnabledInConfigSection({
                cfg: cfg,
                sectionKey: params.sectionKey,
                enabled,
            });
        },
        deleteAccount({ cfg }) {
            return params.deleteMode === "clear-fields"
                ? clearTopLevelChannelConfigFields({
                    cfg: cfg,
                    sectionKey: params.sectionKey,
                    clearBaseFields: params.clearBaseFields ?? [],
                })
                : removeTopLevelChannelConfigSection({
                    cfg: cfg,
                    sectionKey: params.sectionKey,
                });
        },
    };
}
/** Build the full shared config adapter for top-level single-account channels with allowlist/default target accessors. */
export function createTopLevelChannelConfigAdapter(params) {
    return createChannelConfigAdapterFromBase({
        base: createTopLevelChannelConfigBase({
            sectionKey: params.sectionKey,
            resolveAccount: params.resolveAccount,
            listAccountIds: params.listAccountIds,
            defaultAccountId: params.defaultAccountId,
            inspectAccount: params.inspectAccount,
            deleteMode: params.deleteMode,
            clearBaseFields: params.clearBaseFields,
        }),
        resolveAccessorAccount: params.resolveAccessorAccount,
        resolveAccountForAccessors({ cfg }) {
            return params.resolveAccount(cfg);
        },
        resolveAllowFrom: params.resolveAllowFrom,
        formatAllowFrom: params.formatAllowFrom,
        resolveDefaultTo: params.resolveDefaultTo,
    });
}
/** Build CRUD/config helpers for channels where the default account lives at channel root and named accounts live under `accounts`. */
export function createHybridChannelConfigBase(params) {
    return createNamedAccountConfigBase({
        listAccountIds: params.listAccountIds,
        resolveAccount: params.resolveAccount,
        inspectAccount: params.inspectAccount,
        defaultAccountId: params.defaultAccountId,
        setAccountEnabled({ cfg, accountId, enabled }) {
            if (normalizeAccountId(accountId) === DEFAULT_ACCOUNT_ID) {
                return setTopLevelChannelEnabledInConfigSection({
                    cfg,
                    sectionKey: params.sectionKey,
                    enabled,
                });
            }
            return setAccountEnabledInConfigSectionInSection({
                cfg,
                sectionKey: params.sectionKey,
                accountId,
                enabled,
            });
        },
        deleteAccount({ cfg, accountId }) {
            if (normalizeAccountId(accountId) === DEFAULT_ACCOUNT_ID) {
                if (params.preserveSectionOnDefaultDelete) {
                    return clearTopLevelChannelConfigFields({
                        cfg,
                        sectionKey: params.sectionKey,
                        clearBaseFields: params.clearBaseFields,
                    });
                }
                return deleteAccountFromConfigSectionInSection({
                    cfg,
                    sectionKey: params.sectionKey,
                    accountId,
                    clearBaseFields: params.clearBaseFields,
                });
            }
            return deleteAccountFromConfigSectionInSection({
                cfg,
                sectionKey: params.sectionKey,
                accountId,
                clearBaseFields: params.clearBaseFields,
            });
        },
    });
}
/** Build the full shared config adapter for hybrid channels with allowlist/default target accessors. */
export function createHybridChannelConfigAdapter(params) {
    return createChannelConfigAdapterFromBase({
        base: createHybridChannelConfigBase({
            sectionKey: params.sectionKey,
            listAccountIds: params.listAccountIds,
            resolveAccount: params.resolveAccount,
            inspectAccount: params.inspectAccount,
            defaultAccountId: params.defaultAccountId,
            clearBaseFields: params.clearBaseFields,
            preserveSectionOnDefaultDelete: params.preserveSectionOnDefaultDelete,
        }),
        resolveAccessorAccount: params.resolveAccessorAccount,
        resolveAccountForAccessors({ cfg, accountId }) {
            return params.resolveAccount(cfg, accountId);
        },
        resolveAllowFrom: params.resolveAllowFrom,
        formatAllowFrom: params.formatAllowFrom,
        resolveDefaultTo: params.resolveDefaultTo,
    });
}
/** Convert account-specific DM security fields into the shared runtime policy resolver shape. */
export function createScopedDmSecurityResolver(params) {
    return ({ cfg, accountId, account, }) => buildAccountScopedDmSecurityPolicy({
        cfg,
        channelKey: params.channelKey,
        accountId,
        fallbackAccountId: params.resolveFallbackAccountId?.(account) ?? account.accountId,
        policy: params.resolvePolicy(account),
        allowFrom: params.resolveAllowFrom(account) ?? [],
        defaultPolicy: params.defaultPolicy,
        allowFromPathSuffix: params.allowFromPathSuffix,
        policyPathSuffix: params.policyPathSuffix,
        approveChannelId: params.approveChannelId,
        approveHint: params.approveHint,
        normalizeEntry: params.normalizeEntry,
    });
}
export { buildAccountScopedDmSecurityPolicy };
function resolveMergedSimpleChannelAccountConfig(params) {
    const channelRoot = params.cfg.channels?.[params.channelKey];
    return resolveMergedAccountConfig({
        channelConfig: channelRoot,
        accounts: channelRoot?.accounts,
        accountId: normalizeAccountId(params.accountId),
        omitKeys: params.omitKeys,
    });
}
/** Read the effective WhatsApp allowlist from merged root/account config without registry indirection. */
export function resolveWhatsAppConfigAllowFrom(params) {
    return mapAllowFromEntries(resolveMergedSimpleChannelAccountConfig({
        cfg: params.cfg,
        channelKey: "whatsapp",
        accountId: params.accountId,
        omitKeys: ["defaultAccount"],
    }).allowFrom);
}
/** Format WhatsApp allowlist entries with the same normalization used by the channel plugin. */
export function formatWhatsAppConfigAllowFromEntries(allowFrom) {
    return allowFrom
        .map((entry) => String(entry).trim())
        .filter((entry) => Boolean(entry))
        .map((entry) => (entry === "*" ? entry : normalizeLocalWhatsAppTarget(entry)))
        .filter((entry) => Boolean(entry));
}
/** Resolve the effective WhatsApp default recipient after account and root config fallback. */
export function resolveWhatsAppConfigDefaultTo(params) {
    return resolveOptionalConfigString(resolveMergedSimpleChannelAccountConfig({
        cfg: params.cfg,
        channelKey: "whatsapp",
        accountId: params.accountId,
        omitKeys: ["defaultAccount"],
    }).defaultTo);
}
/** Read iMessage allowlist entries from merged root/account config without registry indirection. */
export function resolveIMessageConfigAllowFrom(params) {
    return mapAllowFromEntries(resolveMergedSimpleChannelAccountConfig({
        cfg: params.cfg,
        channelKey: "imessage",
        accountId: params.accountId,
    }).allowFrom);
}
/** Resolve the effective iMessage default recipient from merged root/account config. */
export function resolveIMessageConfigDefaultTo(params) {
    return resolveOptionalConfigString(resolveMergedSimpleChannelAccountConfig({
        cfg: params.cfg,
        channelKey: "imessage",
        accountId: params.accountId,
    }).defaultTo);
}
