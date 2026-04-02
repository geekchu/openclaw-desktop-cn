import { deriveLastRoutePolicy, resolveAgentRoute, } from "openclaw/plugin-sdk/routing";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
export function buildDiscordRoutePeer(params) {
    return {
        kind: params.isDirectMessage ? "direct" : params.isGroupDm ? "group" : "channel",
        id: params.isDirectMessage
            ? params.directUserId?.trim() || params.conversationId
            : params.conversationId,
    };
}
export function resolveDiscordConversationRoute(params) {
    return resolveAgentRoute({
        cfg: params.cfg,
        channel: "discord",
        accountId: params.accountId,
        guildId: params.guildId ?? undefined,
        memberRoleIds: params.memberRoleIds,
        peer: params.peer,
        parentPeer: params.parentConversationId
            ? { kind: "channel", id: params.parentConversationId }
            : undefined,
    });
}
export function resolveDiscordBoundConversationRoute(params) {
    const route = resolveDiscordConversationRoute({
        cfg: params.cfg,
        accountId: params.accountId,
        guildId: params.guildId,
        memberRoleIds: params.memberRoleIds,
        peer: buildDiscordRoutePeer({
            isDirectMessage: params.isDirectMessage,
            isGroupDm: params.isGroupDm,
            directUserId: params.directUserId,
            conversationId: params.conversationId,
        }),
        parentConversationId: params.parentConversationId,
    });
    return resolveDiscordEffectiveRoute({
        route,
        boundSessionKey: params.boundSessionKey,
        configuredRoute: params.configuredRoute,
        matchedBy: params.matchedBy,
    });
}
export function resolveDiscordEffectiveRoute(params) {
    const boundSessionKey = params.boundSessionKey?.trim();
    if (!boundSessionKey) {
        return params.configuredRoute?.route ?? params.route;
    }
    return {
        ...params.route,
        sessionKey: boundSessionKey,
        agentId: resolveAgentIdFromSessionKey(boundSessionKey),
        lastRoutePolicy: deriveLastRoutePolicy({
            sessionKey: boundSessionKey,
            mainSessionKey: params.route.mainSessionKey,
        }),
        ...(params.matchedBy ? { matchedBy: params.matchedBy } : {}),
    };
}
