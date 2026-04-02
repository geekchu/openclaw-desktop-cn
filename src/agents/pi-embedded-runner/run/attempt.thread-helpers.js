import { joinPresentTextSegments } from "../../../shared/text/join-segments.js";
export const ATTEMPT_CACHE_TTL_CUSTOM_TYPE = "openclaw.cache-ttl";
export function composeSystemPromptWithHookContext(params) {
    const prependSystem = params.prependSystemContext?.trim();
    const appendSystem = params.appendSystemContext?.trim();
    if (!prependSystem && !appendSystem) {
        return undefined;
    }
    return joinPresentTextSegments([params.prependSystemContext, params.baseSystemPrompt, params.appendSystemContext], { trim: true });
}
export function resolveAttemptSpawnWorkspaceDir(params) {
    return params.sandbox?.enabled && params.sandbox.workspaceAccess !== "rw"
        ? params.resolvedWorkspace
        : undefined;
}
export function shouldUseOpenAIWebSocketTransport(params) {
    return ((params.modelApi === "openai-responses" && params.provider === "openai") ||
        (params.modelApi === "openai-codex-responses" && params.provider === "openai-codex"));
}
export function shouldAppendAttemptCacheTtl(params) {
    if (params.timedOutDuringCompaction || params.compactionOccurredThisAttempt) {
        return false;
    }
    return (params.config?.agents?.defaults?.contextPruning?.mode === "cache-ttl" &&
        params.isCacheTtlEligibleProvider(params.provider, params.modelId));
}
export function appendAttemptCacheTtlIfNeeded(params) {
    if (!shouldAppendAttemptCacheTtl(params)) {
        return false;
    }
    params.sessionManager.appendCustomEntry?.(ATTEMPT_CACHE_TTL_CUSTOM_TYPE, {
        timestamp: params.now ?? Date.now(),
        provider: params.provider,
        modelId: params.modelId,
    });
    return true;
}
