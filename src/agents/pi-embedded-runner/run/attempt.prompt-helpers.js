import { isCronSessionKey, isSubagentSessionKey } from "../../../routing/session-key.js";
import { joinPresentTextSegments } from "../../../shared/text/join-segments.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "../../tool-fs-policy.js";
import { buildEmbeddedCompactionRuntimeContext } from "../compaction-runtime-context.js";
import { log } from "../logger.js";
import { shouldInjectHeartbeatPromptForTrigger } from "./trigger-policy.js";
export async function resolvePromptBuildHookResult(params) {
    const promptBuildResult = params.hookRunner?.hasHooks("before_prompt_build")
        ? await params.hookRunner
            .runBeforePromptBuild({
            prompt: params.prompt,
            messages: params.messages,
        }, params.hookCtx)
            .catch((hookErr) => {
            log.warn(`before_prompt_build hook failed: ${String(hookErr)}`);
            return undefined;
        })
        : undefined;
    const legacyResult = params.legacyBeforeAgentStartResult ??
        (params.hookRunner?.hasHooks("before_agent_start")
            ? await params.hookRunner
                .runBeforeAgentStart({
                prompt: params.prompt,
                messages: params.messages,
            }, params.hookCtx)
                .catch((hookErr) => {
                log.warn(`before_agent_start hook (legacy prompt build path) failed: ${String(hookErr)}`);
                return undefined;
            })
            : undefined);
    return {
        systemPrompt: promptBuildResult?.systemPrompt ?? legacyResult?.systemPrompt,
        prependContext: joinPresentTextSegments([
            promptBuildResult?.prependContext,
            legacyResult?.prependContext,
        ]),
        prependSystemContext: joinPresentTextSegments([
            promptBuildResult?.prependSystemContext,
            legacyResult?.prependSystemContext,
        ]),
        appendSystemContext: joinPresentTextSegments([
            promptBuildResult?.appendSystemContext,
            legacyResult?.appendSystemContext,
        ]),
    };
}
export function resolvePromptModeForSession(sessionKey) {
    if (!sessionKey) {
        return "full";
    }
    return isSubagentSessionKey(sessionKey) || isCronSessionKey(sessionKey) ? "minimal" : "full";
}
export function shouldInjectHeartbeatPrompt(params) {
    return params.isDefaultAgent && shouldInjectHeartbeatPromptForTrigger(params.trigger);
}
export function resolveAttemptFsWorkspaceOnly(params) {
    return resolveEffectiveToolFsWorkspaceOnly({
        cfg: params.config,
        agentId: params.sessionAgentId,
    });
}
export function prependSystemPromptAddition(params) {
    if (!params.systemPromptAddition) {
        return params.systemPrompt;
    }
    return `${params.systemPromptAddition}\n\n${params.systemPrompt}`;
}
/** Build runtime context passed into context-engine afterTurn hooks. */
export function buildAfterTurnRuntimeContext(params) {
    return buildEmbeddedCompactionRuntimeContext({
        sessionKey: params.attempt.sessionKey,
        messageChannel: params.attempt.messageChannel,
        messageProvider: params.attempt.messageProvider,
        agentAccountId: params.attempt.agentAccountId,
        currentChannelId: params.attempt.currentChannelId,
        currentThreadTs: params.attempt.currentThreadTs,
        currentMessageId: params.attempt.currentMessageId,
        authProfileId: params.attempt.authProfileId,
        workspaceDir: params.workspaceDir,
        agentDir: params.agentDir,
        config: params.attempt.config,
        skillsSnapshot: params.attempt.skillsSnapshot,
        senderIsOwner: params.attempt.senderIsOwner,
        senderId: params.attempt.senderId,
        provider: params.attempt.provider,
        modelId: params.attempt.modelId,
        thinkLevel: params.attempt.thinkLevel,
        reasoningLevel: params.attempt.reasoningLevel,
        bashElevated: params.attempt.bashElevated,
        extraSystemPrompt: params.attempt.extraSystemPrompt,
        ownerNumbers: params.attempt.ownerNumbers,
    });
}
