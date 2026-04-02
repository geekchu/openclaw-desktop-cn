import { resolveChannelGroupPolicy, resolveChannelGroupRequireMention, } from "openclaw/plugin-sdk/config-runtime";
import { loadSessionStore, resolveGroupSessionKey, resolveStorePath, } from "openclaw/plugin-sdk/config-runtime";
import { normalizeGroupActivation } from "openclaw/plugin-sdk/reply-runtime";
export function resolveGroupPolicyFor(cfg, conversationId) {
    const groupId = resolveGroupSessionKey({
        From: conversationId,
        ChatType: "group",
        Provider: "whatsapp",
    })?.id;
    const whatsappCfg = cfg.channels?.whatsapp;
    const hasGroupAllowFrom = Boolean(whatsappCfg?.groupAllowFrom?.length || whatsappCfg?.allowFrom?.length);
    return resolveChannelGroupPolicy({
        cfg,
        channel: "whatsapp",
        groupId: groupId ?? conversationId,
        hasGroupAllowFrom,
    });
}
export function resolveGroupRequireMentionFor(cfg, conversationId) {
    const groupId = resolveGroupSessionKey({
        From: conversationId,
        ChatType: "group",
        Provider: "whatsapp",
    })?.id;
    return resolveChannelGroupRequireMention({
        cfg,
        channel: "whatsapp",
        groupId: groupId ?? conversationId,
    });
}
export function resolveGroupActivationFor(params) {
    const storePath = resolveStorePath(params.cfg.session?.store, {
        agentId: params.agentId,
    });
    const store = loadSessionStore(storePath);
    const entry = store[params.sessionKey];
    const requireMention = resolveGroupRequireMentionFor(params.cfg, params.conversationId);
    const defaultActivation = !requireMention ? "always" : "mention";
    return normalizeGroupActivation(entry?.groupActivation) ?? defaultActivation;
}
