import { ChannelType } from "discord-api-types/v10";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import { resolveCommandAuthorizedFromAuthorizers } from "openclaw/plugin-sdk/command-auth";
import { isDangerousNameMatchingEnabled } from "openclaw/plugin-sdk/config-runtime";
import { resolveOpenProviderRuntimeGroupPolicy } from "openclaw/plugin-sdk/config-runtime";
import * as conversationRuntime from "openclaw/plugin-sdk/conversation-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import * as securityRuntime from "openclaw/plugin-sdk/security-runtime";
import { logError } from "openclaw/plugin-sdk/text-runtime";
import { parseDiscordComponentCustomId, parseDiscordModalCustomId, } from "../components.js";
import { isDiscordGroupAllowedByPolicy, normalizeDiscordAllowList, normalizeDiscordSlug, resolveDiscordAllowListMatch, resolveDiscordChannelConfigWithFallback, resolveDiscordGuildEntry, resolveDiscordMemberAccessState, resolveDiscordOwnerAccess, } from "./allow-list.js";
import { formatDiscordUserTag } from "./format.js";
export const AGENT_BUTTON_KEY = "agent";
export const AGENT_SELECT_KEY = "agentsel";
function formatUsername(user) {
    if (user.discriminator && user.discriminator !== "0") {
        return `${user.username}#${user.discriminator}`;
    }
    return user.username;
}
function isThreadChannelType(channelType) {
    return (channelType === ChannelType.PublicThread ||
        channelType === ChannelType.PrivateThread ||
        channelType === ChannelType.AnnouncementThread);
}
function readParsedComponentId(data) {
    if (!data || typeof data !== "object") {
        return undefined;
    }
    return "cid" in data
        ? data.cid
        : data.componentId;
}
function normalizeComponentId(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return undefined;
}
function mapOptionLabels(options, values) {
    if (!options || options.length === 0) {
        return values;
    }
    const map = new Map(options.map((option) => [option.value, option.label]));
    return values.map((value) => map.get(value) ?? value);
}
/**
 * The component custom id only carries the logical button id. Channel binding
 * comes from Discord's trusted interaction payload.
 */
export function buildAgentButtonCustomId(componentId) {
    return `${AGENT_BUTTON_KEY}:componentId=${encodeURIComponent(componentId)}`;
}
export function buildAgentSelectCustomId(componentId) {
    return `${AGENT_SELECT_KEY}:componentId=${encodeURIComponent(componentId)}`;
}
const { resolvePinnedMainDmOwnerFromAllowlist } = securityRuntime;
export function resolveAgentComponentRoute(params) {
    return resolveAgentRoute({
        cfg: params.ctx.cfg,
        channel: "discord",
        accountId: params.ctx.accountId,
        guildId: params.rawGuildId,
        memberRoleIds: params.memberRoleIds,
        peer: {
            kind: params.isDirectMessage ? "direct" : "channel",
            id: params.isDirectMessage ? params.userId : params.channelId,
        },
        parentPeer: params.parentId ? { kind: "channel", id: params.parentId } : undefined,
    });
}
export async function ackComponentInteraction(params) {
    try {
        await params.interaction.reply({
            content: "✓",
            ...params.replyOpts,
        });
    }
    catch (err) {
        logError(`${params.label}: failed to acknowledge interaction: ${String(err)}`);
    }
}
export function resolveDiscordChannelContext(interaction) {
    const channel = interaction.channel;
    const channelName = channel && "name" in channel ? channel.name : undefined;
    const channelSlug = channelName ? normalizeDiscordSlug(channelName) : "";
    const channelType = channel && "type" in channel ? channel.type : undefined;
    const isThread = isThreadChannelType(channelType);
    let parentId;
    let parentName;
    let parentSlug = "";
    if (isThread && channel && "parentId" in channel) {
        parentId = channel.parentId ?? undefined;
        if ("parent" in channel) {
            const parent = channel.parent;
            if (parent?.name) {
                parentName = parent.name;
                parentSlug = normalizeDiscordSlug(parentName);
            }
        }
    }
    return { channelName, channelSlug, channelType, isThread, parentId, parentName, parentSlug };
}
export async function resolveComponentInteractionContext(params) {
    const { interaction, label } = params;
    const channelId = interaction.rawData.channel_id;
    if (!channelId) {
        logError(`${label}: missing channel_id in interaction`);
        return null;
    }
    const user = interaction.user;
    if (!user) {
        logError(`${label}: missing user in interaction`);
        return null;
    }
    const shouldDefer = params.defer !== false && "defer" in interaction;
    let didDefer = false;
    if (shouldDefer) {
        try {
            await interaction.defer({ ephemeral: true });
            didDefer = true;
        }
        catch (err) {
            logError(`${label}: failed to defer interaction: ${String(err)}`);
        }
    }
    const replyOpts = didDefer ? {} : { ephemeral: true };
    const username = formatUsername(user);
    const userId = user.id;
    const rawGuildId = interaction.rawData.guild_id;
    const isDirectMessage = !rawGuildId;
    const memberRoleIds = Array.isArray(interaction.rawData.member?.roles)
        ? interaction.rawData.member.roles.map((roleId) => String(roleId))
        : [];
    return {
        channelId,
        user,
        username,
        userId,
        replyOpts,
        rawGuildId,
        isDirectMessage,
        memberRoleIds,
    };
}
export async function ensureGuildComponentMemberAllowed(params) {
    const { interaction, guildInfo, channelId, rawGuildId, channelCtx, memberRoleIds, user, replyOpts, componentLabel, unauthorizedReply, } = params;
    if (!rawGuildId) {
        return true;
    }
    async function replyUnauthorized() {
        try {
            await interaction.reply({
                content: unauthorizedReply,
                ...replyOpts,
            });
        }
        catch { }
    }
    const channelConfig = resolveDiscordChannelConfigWithFallback({
        guildInfo,
        channelId,
        channelName: channelCtx.channelName,
        channelSlug: channelCtx.channelSlug,
        parentId: channelCtx.parentId,
        parentName: channelCtx.parentName,
        parentSlug: channelCtx.parentSlug,
        scope: channelCtx.isThread ? "thread" : "channel",
    });
    if (channelConfig?.enabled === false) {
        await replyUnauthorized();
        return false;
    }
    const channelAllowlistConfigured = Boolean(guildInfo?.channels) && Object.keys(guildInfo?.channels ?? {}).length > 0;
    const channelAllowed = channelConfig?.allowed !== false;
    if (!isDiscordGroupAllowedByPolicy({
        groupPolicy: params.groupPolicy,
        guildAllowlisted: Boolean(guildInfo),
        channelAllowlistConfigured,
        channelAllowed,
    })) {
        await replyUnauthorized();
        return false;
    }
    if (channelConfig?.allowed === false) {
        await replyUnauthorized();
        return false;
    }
    const { memberAllowed } = resolveDiscordMemberAccessState({
        channelConfig,
        guildInfo,
        memberRoleIds,
        sender: {
            id: user.id,
            name: user.username,
            tag: user.discriminator ? `${user.username}#${user.discriminator}` : undefined,
        },
        allowNameMatching: params.allowNameMatching,
    });
    if (memberAllowed) {
        return true;
    }
    logVerbose(`agent ${componentLabel}: blocked user ${user.id} (not in users/roles allowlist)`);
    await replyUnauthorized();
    return false;
}
export async function ensureComponentUserAllowed(params) {
    const allowList = normalizeDiscordAllowList(params.entry.allowedUsers, [
        "discord:",
        "user:",
        "pk:",
    ]);
    if (!allowList) {
        return true;
    }
    const match = resolveDiscordAllowListMatch({
        allowList,
        candidate: {
            id: params.user.id,
            name: params.user.username,
            tag: formatDiscordUserTag(params.user),
        },
        allowNameMatching: params.allowNameMatching,
    });
    if (match.allowed) {
        return true;
    }
    logVerbose(`discord component ${params.componentLabel}: blocked user ${params.user.id} (not in allowedUsers)`);
    try {
        await params.interaction.reply({
            content: params.unauthorizedReply,
            ...params.replyOpts,
        });
    }
    catch { }
    return false;
}
export async function ensureAgentComponentInteractionAllowed(params) {
    const guildInfo = resolveDiscordGuildEntry({
        guild: params.interaction.guild ?? undefined,
        guildId: params.rawGuildId,
        guildEntries: params.ctx.guildEntries,
    });
    const channelCtx = resolveDiscordChannelContext(params.interaction);
    const memberAllowed = await ensureGuildComponentMemberAllowed({
        interaction: params.interaction,
        guildInfo,
        channelId: params.channelId,
        rawGuildId: params.rawGuildId,
        channelCtx,
        memberRoleIds: params.memberRoleIds,
        user: params.user,
        replyOpts: params.replyOpts,
        componentLabel: params.componentLabel,
        unauthorizedReply: params.unauthorizedReply,
        allowNameMatching: isDangerousNameMatchingEnabled(params.ctx.discordConfig),
        groupPolicy: resolveOpenProviderRuntimeGroupPolicy({
            providerConfigPresent: params.ctx.cfg.channels?.discord !== undefined,
            groupPolicy: params.ctx.discordConfig?.groupPolicy,
            defaultGroupPolicy: params.ctx.cfg.channels?.defaults?.groupPolicy,
        }).groupPolicy,
    });
    if (!memberAllowed) {
        return null;
    }
    return { parentId: channelCtx.parentId };
}
export function parseAgentComponentData(data) {
    const raw = readParsedComponentId(data);
    const decodeSafe = (value) => {
        if (!value.includes("%")) {
            return value;
        }
        if (!/%[0-9A-Fa-f]{2}/.test(value)) {
            return value;
        }
        try {
            return decodeURIComponent(value);
        }
        catch {
            return value;
        }
    };
    const componentId = typeof raw === "string" ? decodeSafe(raw) : typeof raw === "number" ? String(raw) : null;
    if (!componentId) {
        return null;
    }
    return { componentId };
}
async function ensureDmComponentAuthorized(params) {
    const { ctx, interaction, user, componentLabel, replyOpts } = params;
    const allowFromPrefixes = ["discord:", "user:", "pk:"];
    const resolveAllowMatch = (entries) => {
        const allowList = normalizeDiscordAllowList(entries, allowFromPrefixes);
        return allowList
            ? resolveDiscordAllowListMatch({
                allowList,
                candidate: {
                    id: user.id,
                    name: user.username,
                    tag: formatDiscordUserTag(user),
                },
                allowNameMatching: isDangerousNameMatchingEnabled(ctx.discordConfig),
            })
            : { allowed: false };
    };
    const dmPolicy = ctx.dmPolicy ?? "pairing";
    if (dmPolicy === "disabled") {
        logVerbose(`agent ${componentLabel}: blocked (DM policy disabled)`);
        try {
            await interaction.reply({
                content: "DM interactions are disabled.",
                ...replyOpts,
            });
        }
        catch { }
        return false;
    }
    if (dmPolicy === "open") {
        return true;
    }
    if (dmPolicy === "allowlist") {
        const allowMatch = resolveAllowMatch(ctx.allowFrom ?? []);
        if (allowMatch.allowed) {
            return true;
        }
        logVerbose(`agent ${componentLabel}: blocked DM user ${user.id} (not in allowFrom)`);
        try {
            await interaction.reply({
                content: `You are not authorized to use this ${componentLabel}.`,
                ...replyOpts,
            });
        }
        catch { }
        return false;
    }
    const storeAllowFrom = await securityRuntime.readStoreAllowFromForDmPolicy({
        provider: "discord",
        accountId: ctx.accountId,
        dmPolicy,
    });
    const allowMatch = resolveAllowMatch([...(ctx.allowFrom ?? []), ...storeAllowFrom]);
    if (allowMatch.allowed) {
        return true;
    }
    if (dmPolicy === "pairing") {
        const pairingResult = await createChannelPairingChallengeIssuer({
            channel: "discord",
            upsertPairingRequest: async ({ id, meta }) => await conversationRuntime.upsertChannelPairingRequest({
                channel: "discord",
                id,
                accountId: ctx.accountId,
                meta,
            }),
        })({
            senderId: user.id,
            senderIdLine: `Your Discord user id: ${user.id}`,
            meta: {
                tag: formatDiscordUserTag(user),
                name: user.username,
            },
            sendPairingReply: async (text) => {
                await interaction.reply({
                    content: text,
                    ...replyOpts,
                });
            },
        });
        if (!pairingResult.created) {
            try {
                await interaction.reply({
                    content: "Pairing already requested. Ask the bot owner to approve your code.",
                    ...replyOpts,
                });
            }
            catch { }
        }
        return false;
    }
    logVerbose(`agent ${componentLabel}: blocked DM user ${user.id} (not in allowFrom)`);
    try {
        await interaction.reply({
            content: `You are not authorized to use this ${componentLabel}.`,
            ...replyOpts,
        });
    }
    catch { }
    return false;
}
export async function resolveInteractionContextWithDmAuth(params) {
    const interactionCtx = await resolveComponentInteractionContext({
        interaction: params.interaction,
        label: params.label,
        defer: params.defer,
    });
    if (!interactionCtx) {
        return null;
    }
    if (interactionCtx.isDirectMessage) {
        const authorized = await ensureDmComponentAuthorized({
            ctx: params.ctx,
            interaction: params.interaction,
            user: interactionCtx.user,
            componentLabel: params.componentLabel,
            replyOpts: interactionCtx.replyOpts,
        });
        if (!authorized) {
            return null;
        }
    }
    return interactionCtx;
}
export function parseDiscordComponentData(data, customId) {
    if (!data || typeof data !== "object") {
        return null;
    }
    const rawComponentId = readParsedComponentId(data);
    const rawModalId = "mid" in data ? data.mid : data.modalId;
    let componentId = normalizeComponentId(rawComponentId);
    let modalId = normalizeComponentId(rawModalId);
    if (!componentId && customId) {
        const parsed = parseDiscordComponentCustomId(customId);
        if (parsed) {
            componentId = parsed.componentId;
            modalId = parsed.modalId;
        }
    }
    if (!componentId) {
        return null;
    }
    return { componentId, modalId };
}
export function parseDiscordModalId(data, customId) {
    if (data && typeof data === "object") {
        const rawModalId = "mid" in data ? data.mid : data.modalId;
        const modalId = normalizeComponentId(rawModalId);
        if (modalId) {
            return modalId;
        }
    }
    if (customId) {
        return parseDiscordModalCustomId(customId);
    }
    return null;
}
export function resolveInteractionCustomId(interaction) {
    if (!interaction?.rawData || typeof interaction.rawData !== "object") {
        return undefined;
    }
    if (!("data" in interaction.rawData)) {
        return undefined;
    }
    const data = interaction.rawData.data;
    const customId = data?.custom_id;
    if (typeof customId !== "string") {
        return undefined;
    }
    const trimmed = customId.trim();
    return trimmed ? trimmed : undefined;
}
export function mapSelectValues(entry, values) {
    if (entry.selectType === "string") {
        return mapOptionLabels(entry.options, values);
    }
    if (entry.selectType === "user") {
        return values.map((value) => `user:${value}`);
    }
    if (entry.selectType === "role") {
        return values.map((value) => `role:${value}`);
    }
    if (entry.selectType === "mentionable") {
        return values.map((value) => `mentionable:${value}`);
    }
    if (entry.selectType === "channel") {
        return values.map((value) => `channel:${value}`);
    }
    return values;
}
export function resolveModalFieldValues(field, interaction) {
    const fields = interaction.fields;
    const optionLabels = field.options?.map((option) => ({
        value: option.value,
        label: option.label,
    }));
    const required = field.required === true;
    try {
        switch (field.type) {
            case "text": {
                const value = required ? fields.getText(field.id, true) : fields.getText(field.id);
                return value ? [value] : [];
            }
            case "select":
            case "checkbox":
            case "radio": {
                const values = required
                    ? fields.getStringSelect(field.id, true)
                    : (fields.getStringSelect(field.id) ?? []);
                return mapOptionLabels(optionLabels, values);
            }
            case "role-select": {
                try {
                    const roles = required
                        ? fields.getRoleSelect(field.id, true)
                        : (fields.getRoleSelect(field.id) ?? []);
                    return roles.map((role) => role.name ?? role.id);
                }
                catch {
                    const values = required
                        ? fields.getStringSelect(field.id, true)
                        : (fields.getStringSelect(field.id) ?? []);
                    return values;
                }
            }
            case "user-select": {
                const users = required
                    ? fields.getUserSelect(field.id, true)
                    : (fields.getUserSelect(field.id) ?? []);
                return users.map((user) => formatDiscordUserTag(user));
            }
            default:
                return [];
        }
    }
    catch (err) {
        logError(`agent modal: failed to read field ${field.id}: ${String(err)}`);
        return [];
    }
}
export function formatModalSubmissionText(entry, interaction) {
    const lines = [`Form "${entry.title}" submitted.`];
    for (const field of entry.fields) {
        const values = resolveModalFieldValues(field, interaction);
        if (values.length === 0) {
            continue;
        }
        lines.push(`- ${field.label}: ${values.join(", ")}`);
    }
    if (lines.length === 1) {
        lines.push("- (no values)");
    }
    return lines.join("\n");
}
export function resolveDiscordInteractionId(interaction) {
    const rawId = interaction.rawData && typeof interaction.rawData === "object" && "id" in interaction.rawData
        ? interaction.rawData.id
        : undefined;
    if (typeof rawId === "string" && rawId.trim()) {
        return rawId.trim();
    }
    if (typeof rawId === "number" && Number.isFinite(rawId)) {
        return String(rawId);
    }
    return `discord-interaction:${Date.now()}`;
}
export function resolveComponentCommandAuthorized(params) {
    const { ctx, interactionCtx, channelConfig, guildInfo } = params;
    if (interactionCtx.isDirectMessage) {
        return true;
    }
    const { ownerAllowList, ownerAllowed: ownerOk } = resolveDiscordOwnerAccess({
        allowFrom: ctx.allowFrom,
        sender: {
            id: interactionCtx.user.id,
            name: interactionCtx.user.username,
            tag: formatDiscordUserTag(interactionCtx.user),
        },
        allowNameMatching: params.allowNameMatching,
    });
    const { hasAccessRestrictions, memberAllowed } = resolveDiscordMemberAccessState({
        channelConfig,
        guildInfo,
        memberRoleIds: interactionCtx.memberRoleIds,
        sender: {
            id: interactionCtx.user.id,
            name: interactionCtx.user.username,
            tag: formatDiscordUserTag(interactionCtx.user),
        },
        allowNameMatching: params.allowNameMatching,
    });
    const useAccessGroups = ctx.cfg.commands?.useAccessGroups !== false;
    const authorizers = useAccessGroups
        ? [
            { configured: ownerAllowList != null, allowed: ownerOk },
            { configured: hasAccessRestrictions, allowed: memberAllowed },
        ]
        : [{ configured: hasAccessRestrictions, allowed: memberAllowed }];
    return resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers,
        modeWhenAccessGroupsOff: "configured",
    });
}
export { resolveDiscordGuildEntry, resolvePinnedMainDmOwnerFromAllowlist };
