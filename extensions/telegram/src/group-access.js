import { resolveOpenProviderRuntimeGroupPolicy } from "openclaw/plugin-sdk/config-runtime";
import { evaluateMatchedGroupAccessForPolicy } from "openclaw/plugin-sdk/group-access";
import { isSenderAllowed } from "./bot-access.js";
import { firstDefined } from "./bot-access.js";
function isGroupAllowOverrideAuthorized(params) {
    if (!params.effectiveGroupAllow.hasEntries) {
        return false;
    }
    const senderId = params.senderId ?? "";
    if (params.requireSenderForAllowOverride && !senderId) {
        return false;
    }
    return isSenderAllowed({
        allow: params.effectiveGroupAllow,
        senderId,
        senderUsername: params.senderUsername ?? "",
    });
}
export const evaluateTelegramGroupBaseAccess = (params) => {
    // Check enabled flags for both groups and DMs
    if (params.groupConfig?.enabled === false) {
        return { allowed: false, reason: "group-disabled" };
    }
    if (params.topicConfig?.enabled === false) {
        return { allowed: false, reason: "topic-disabled" };
    }
    if (!params.isGroup) {
        // For DMs, check allowFrom override if present
        if (params.enforceAllowOverride && params.hasGroupAllowOverride) {
            if (!isGroupAllowOverrideAuthorized({
                effectiveGroupAllow: params.effectiveGroupAllow,
                senderId: params.senderId,
                senderUsername: params.senderUsername,
                requireSenderForAllowOverride: params.requireSenderForAllowOverride,
            })) {
                return { allowed: false, reason: "group-override-unauthorized" };
            }
        }
        return { allowed: true };
    }
    if (!params.enforceAllowOverride || !params.hasGroupAllowOverride) {
        return { allowed: true };
    }
    if (!isGroupAllowOverrideAuthorized({
        effectiveGroupAllow: params.effectiveGroupAllow,
        senderId: params.senderId,
        senderUsername: params.senderUsername,
        requireSenderForAllowOverride: params.requireSenderForAllowOverride,
    })) {
        return { allowed: false, reason: "group-override-unauthorized" };
    }
    return { allowed: true };
};
export const resolveTelegramRuntimeGroupPolicy = (params) => resolveOpenProviderRuntimeGroupPolicy({
    providerConfigPresent: params.providerConfigPresent,
    groupPolicy: params.groupPolicy,
    defaultGroupPolicy: params.defaultGroupPolicy,
});
export const evaluateTelegramGroupPolicyAccess = (params) => {
    const { groupPolicy: runtimeFallbackPolicy } = resolveTelegramRuntimeGroupPolicy({
        providerConfigPresent: params.cfg.channels?.telegram !== undefined,
        groupPolicy: params.telegramCfg.groupPolicy,
        defaultGroupPolicy: params.cfg.channels?.defaults?.groupPolicy,
    });
    const fallbackPolicy = firstDefined(params.telegramCfg.groupPolicy, params.cfg.channels?.defaults?.groupPolicy) ??
        runtimeFallbackPolicy;
    const groupPolicy = params.useTopicAndGroupOverrides
        ? (firstDefined(params.topicConfig?.groupPolicy, params.groupConfig?.groupPolicy, params.telegramCfg.groupPolicy, params.cfg.channels?.defaults?.groupPolicy) ?? runtimeFallbackPolicy)
        : fallbackPolicy;
    if (!params.isGroup || !params.enforcePolicy) {
        return { allowed: true, groupPolicy };
    }
    if (groupPolicy === "disabled") {
        return { allowed: false, reason: "group-policy-disabled", groupPolicy };
    }
    // Check chat-level allowlist first so that groups explicitly listed in the
    // `groups` config are not blocked by the sender-level "empty allowlist" guard.
    let chatExplicitlyAllowed = false;
    if (params.checkChatAllowlist) {
        const groupAllowlist = params.resolveGroupPolicy(params.chatId);
        if (groupAllowlist.allowlistEnabled && !groupAllowlist.allowed) {
            return { allowed: false, reason: "group-chat-not-allowed", groupPolicy };
        }
        // The chat is explicitly allowed when it has a dedicated entry in the groups
        // config (groupConfig is set).  A wildcard ("*") match alone does not count
        // because it only enables the group — sender-level filtering still applies.
        if (groupAllowlist.allowlistEnabled && groupAllowlist.allowed && groupAllowlist.groupConfig) {
            chatExplicitlyAllowed = true;
        }
    }
    if (groupPolicy === "allowlist" && params.enforceAllowlistAuthorization) {
        const senderId = params.senderId ?? "";
        const senderAuthorization = evaluateMatchedGroupAccessForPolicy({
            groupPolicy,
            requireMatchInput: params.requireSenderForAllowlistAuthorization,
            hasMatchInput: Boolean(senderId),
            allowlistConfigured: chatExplicitlyAllowed ||
                params.allowEmptyAllowlistEntries ||
                params.effectiveGroupAllow.hasEntries,
            allowlistMatched: (chatExplicitlyAllowed && !params.effectiveGroupAllow.hasEntries) ||
                isSenderAllowed({
                    allow: params.effectiveGroupAllow,
                    senderId,
                    senderUsername: params.senderUsername ?? "",
                }),
        });
        if (!senderAuthorization.allowed && senderAuthorization.reason === "missing_match_input") {
            return { allowed: false, reason: "group-policy-allowlist-no-sender", groupPolicy };
        }
        if (!senderAuthorization.allowed && senderAuthorization.reason === "empty_allowlist") {
            return { allowed: false, reason: "group-policy-allowlist-empty", groupPolicy };
        }
        if (!senderAuthorization.allowed && senderAuthorization.reason === "not_allowlisted") {
            return { allowed: false, reason: "group-policy-allowlist-unauthorized", groupPolicy };
        }
    }
    return { allowed: true, groupPolicy };
};
