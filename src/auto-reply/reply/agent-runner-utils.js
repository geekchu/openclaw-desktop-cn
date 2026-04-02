import { resolveRunModelFallbacksOverride } from "../../agents/agent-scope.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import { normalizeAnyChannelId, normalizeChannelId } from "../../channels/registry.js";
import { isReasoningTagProvider } from "../../utils/provider-utils.js";
import { resolveProviderScopedAuthProfile, resolveRunAuthProfile, } from "./agent-runner-auth-profile.js";
export { resolveProviderScopedAuthProfile, resolveRunAuthProfile };
import { resolveOriginMessageProvider, resolveOriginMessageTo } from "./origin-routing.js";
const BUN_FETCH_SOCKET_ERROR_RE = /socket connection was closed unexpectedly/i;
/**
 * Build provider-specific threading context for tool auto-injection.
 */
export function buildThreadingToolContext(params) {
    const { sessionCtx, config, hasRepliedRef } = params;
    const currentMessageId = sessionCtx.MessageSidFull ?? sessionCtx.MessageSid;
    const originProvider = resolveOriginMessageProvider({
        originatingChannel: sessionCtx.OriginatingChannel,
        provider: sessionCtx.Provider,
    });
    const originTo = resolveOriginMessageTo({
        originatingTo: sessionCtx.OriginatingTo,
        to: sessionCtx.To,
    });
    if (!config) {
        return {
            currentMessageId,
        };
    }
    const rawProvider = originProvider?.trim().toLowerCase();
    if (!rawProvider) {
        return {
            currentMessageId,
        };
    }
    const provider = normalizeChannelId(rawProvider) ?? normalizeAnyChannelId(rawProvider);
    // Fallback for unrecognized/plugin channels (e.g., BlueBubbles before plugin registry init)
    const threading = provider ? getChannelPlugin(provider)?.threading : undefined;
    if (!threading?.buildToolContext) {
        return {
            currentChannelId: originTo?.trim() || undefined,
            currentChannelProvider: provider ?? rawProvider,
            currentMessageId,
            hasRepliedRef,
        };
    }
    const context = threading.buildToolContext({
        cfg: config,
        accountId: sessionCtx.AccountId,
        context: {
            Channel: originProvider,
            From: sessionCtx.From,
            To: originTo,
            ChatType: sessionCtx.ChatType,
            CurrentMessageId: currentMessageId,
            ReplyToId: sessionCtx.ReplyToId,
            ThreadLabel: sessionCtx.ThreadLabel,
            MessageThreadId: sessionCtx.MessageThreadId,
            NativeChannelId: sessionCtx.NativeChannelId,
        },
        hasRepliedRef,
    }) ?? {};
    return {
        ...context,
        currentChannelProvider: provider, // guaranteed non-null since threading exists
        currentMessageId: context.currentMessageId ?? currentMessageId,
    };
}
export const isBunFetchSocketError = (message) => Boolean(message && BUN_FETCH_SOCKET_ERROR_RE.test(message));
export const formatBunFetchSocketError = (message) => {
    const trimmed = message.trim();
    return [
        "⚠️ LLM connection failed. This could be due to server issues, network problems, or context length exceeded (e.g., with local LLMs like LM Studio). Original error:",
        "```",
        trimmed || "Unknown error",
        "```",
    ].join("\n");
};
export const resolveEnforceFinalTag = (run, provider) => Boolean(run.enforceFinalTag || isReasoningTagProvider(provider));
export function resolveModelFallbackOptions(run) {
    return {
        cfg: run.config,
        provider: run.provider,
        model: run.model,
        agentDir: run.agentDir,
        fallbacksOverride: resolveRunModelFallbacksOverride({
            cfg: run.config,
            agentId: run.agentId,
            sessionKey: run.sessionKey,
        }),
    };
}
export function buildEmbeddedRunBaseParams(params) {
    return {
        sessionFile: params.run.sessionFile,
        workspaceDir: params.run.workspaceDir,
        agentDir: params.run.agentDir,
        config: params.run.config,
        skillsSnapshot: params.run.skillsSnapshot,
        ownerNumbers: params.run.ownerNumbers,
        inputProvenance: params.run.inputProvenance,
        senderIsOwner: params.run.senderIsOwner,
        enforceFinalTag: resolveEnforceFinalTag(params.run, params.provider),
        provider: params.provider,
        model: params.model,
        ...params.authProfile,
        thinkLevel: params.run.thinkLevel,
        verboseLevel: params.run.verboseLevel,
        reasoningLevel: params.run.reasoningLevel,
        execOverrides: params.run.execOverrides,
        bashElevated: params.run.bashElevated,
        timeoutMs: params.run.timeoutMs,
        runId: params.runId,
        allowTransientCooldownProbe: params.allowTransientCooldownProbe,
    };
}
export function buildEmbeddedContextFromTemplate(params) {
    return {
        sessionId: params.run.sessionId,
        sessionKey: params.run.sessionKey,
        agentId: params.run.agentId,
        messageProvider: resolveOriginMessageProvider({
            originatingChannel: params.sessionCtx.OriginatingChannel,
            provider: params.sessionCtx.Provider,
        }),
        agentAccountId: params.sessionCtx.AccountId,
        messageTo: resolveOriginMessageTo({
            originatingTo: params.sessionCtx.OriginatingTo,
            to: params.sessionCtx.To,
        }),
        messageThreadId: params.sessionCtx.MessageThreadId ?? undefined,
        // Provider threading context for tool auto-injection
        ...buildThreadingToolContext({
            sessionCtx: params.sessionCtx,
            config: params.run.config,
            hasRepliedRef: params.hasRepliedRef,
        }),
    };
}
export function buildTemplateSenderContext(sessionCtx) {
    return {
        senderId: sessionCtx.SenderId?.trim() || undefined,
        senderName: sessionCtx.SenderName?.trim() || undefined,
        senderUsername: sessionCtx.SenderUsername?.trim() || undefined,
        senderE164: sessionCtx.SenderE164?.trim() || undefined,
    };
}
export function buildEmbeddedRunContexts(params) {
    return {
        authProfile: resolveRunAuthProfile(params.run, params.provider),
        embeddedContext: buildEmbeddedContextFromTemplate({
            run: params.run,
            sessionCtx: params.sessionCtx,
            hasRepliedRef: params.hasRepliedRef,
        }),
        senderContext: buildTemplateSenderContext(params.sessionCtx),
    };
}
export function buildEmbeddedRunExecutionParams(params) {
    const { authProfile, embeddedContext, senderContext } = buildEmbeddedRunContexts(params);
    const runBaseParams = buildEmbeddedRunBaseParams({
        run: params.run,
        provider: params.provider,
        model: params.model,
        runId: params.runId,
        authProfile,
        allowTransientCooldownProbe: params.allowTransientCooldownProbe,
    });
    return {
        embeddedContext,
        senderContext,
        runBaseParams,
    };
}
