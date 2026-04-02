import * as conversationRuntime from "openclaw/plugin-sdk/conversation-runtime";
import { resolveDiscordBoundConversationRoute, resolveDiscordEffectiveRoute, } from "./route-resolution.js";
export async function resolveDiscordNativeInteractionRouteState(params) {
    const route = resolveDiscordBoundConversationRoute({
        cfg: params.cfg,
        accountId: params.accountId,
        guildId: params.guildId,
        memberRoleIds: params.memberRoleIds,
        isDirectMessage: params.isDirectMessage,
        isGroupDm: params.isGroupDm,
        directUserId: params.directUserId,
        conversationId: params.conversationId,
        parentConversationId: params.parentConversationId,
    });
    const configuredRoute = params.threadBinding == null
        ? conversationRuntime.resolveConfiguredBindingRoute({
            cfg: params.cfg,
            route,
            conversation: {
                channel: "discord",
                accountId: params.accountId,
                conversationId: params.conversationId,
                parentConversationId: params.parentConversationId,
            },
        })
        : null;
    const configuredBinding = configuredRoute?.bindingResolution ?? null;
    const configuredBoundSessionKey = configuredRoute?.boundSessionKey?.trim() || undefined;
    const boundSessionKey = params.threadBinding?.targetSessionKey?.trim() || configuredBoundSessionKey;
    const effectiveRoute = resolveDiscordEffectiveRoute({
        route,
        boundSessionKey,
        configuredRoute,
        matchedBy: configuredBinding ? "binding.channel" : undefined,
    });
    const bindingReadiness = params.enforceConfiguredBindingReadiness && configuredBinding
        ? await conversationRuntime.ensureConfiguredBindingRouteReady({
            cfg: params.cfg,
            bindingResolution: configuredBinding,
        })
        : null;
    return {
        route,
        effectiveRoute,
        boundSessionKey,
        configuredRoute,
        configuredBinding,
        bindingReadiness,
    };
}
