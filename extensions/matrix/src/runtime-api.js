export { DEFAULT_ACCOUNT_ID, normalizeAccountId, normalizeOptionalAccountId, } from "openclaw/plugin-sdk/account-id";
export { createActionGate, jsonResult, readNumberParam, readReactionParams, readStringArrayParam, readStringParam, } from "openclaw/plugin-sdk/channel-actions";
export { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-primitives";
export { formatLocationText, logInboundDrop, toLocationContext, } from "openclaw/plugin-sdk/channel-inbound";
export { resolveAckReaction, logTypingFailure } from "openclaw/plugin-sdk/channel-feedback";
export { GROUP_POLICY_BLOCKED_LABEL, resolveAllowlistProviderRuntimeGroupPolicy, resolveDefaultGroupPolicy, warnMissingProviderGroupPolicyFallbackOnce, } from "openclaw/plugin-sdk/config-runtime";
export { addWildcardAllowFrom, formatDocsLink, hasConfiguredSecretInput, mergeAllowFromEntries, moveSingleAccountChannelSectionToDefaultAccount, promptAccountId, promptChannelAccessConfig, splitSetupEntries, } from "openclaw/plugin-sdk/setup";
export { assertHttpUrlTargetsPrivateNetwork, closeDispatcher, createPinnedDispatcher, isPrivateOrLoopbackHost, resolvePinnedHostnameWithPolicy, ssrfPolicyFromDangerouslyAllowPrivateNetwork, ssrfPolicyFromAllowPrivateNetwork, } from "openclaw/plugin-sdk/ssrf-runtime";
export { dispatchReplyFromConfigWithSettledDispatcher } from "openclaw/plugin-sdk/inbound-reply-dispatch";
export { ensureConfiguredAcpBindingReady, resolveConfiguredAcpBindingRecord, } from "openclaw/plugin-sdk/acp-binding-runtime";
export { buildProbeChannelStatusSummary, collectStatusIssuesFromLastError, PAIRING_APPROVED_MESSAGE, } from "openclaw/plugin-sdk/channel-status";
export { getSessionBindingService, resolveThreadBindingIdleTimeoutMsForChannel, resolveThreadBindingMaxAgeMsForChannel, } from "openclaw/plugin-sdk/conversation-runtime";
export { resolveOutboundSendDep } from "openclaw/plugin-sdk/outbound-runtime";
export { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
export { chunkTextForOutbound } from "openclaw/plugin-sdk/text-chunking";
export { createChannelReplyPipeline } from "openclaw/plugin-sdk/channel-reply-pipeline";
export { loadOutboundMediaFromUrl } from "openclaw/plugin-sdk/outbound-media";
export { normalizePollInput } from "openclaw/plugin-sdk/media-runtime";
export { writeJsonFileAtomically } from "openclaw/plugin-sdk/json-store";
export { buildChannelKeyCandidates, resolveChannelEntryMatch, } from "openclaw/plugin-sdk/channel-targets";
export { evaluateGroupRouteAccessForPolicy, resolveSenderScopedGroupPolicy, } from "openclaw/plugin-sdk/channel-policy";
export { formatZonedTimestamp, } from "openclaw/plugin-sdk/matrix-runtime-shared";
// resolveMatrixAccountStringValues already comes from plugin-sdk/matrix.
// Re-exporting auth-precedence here makes Jiti try to define the same export twice.
export function buildTimeoutAbortSignal(params) {
    const { timeoutMs, signal } = params;
    if (!timeoutMs && !signal) {
        return { signal: undefined, cleanup: () => { } };
    }
    if (!timeoutMs) {
        return { signal, cleanup: () => { } };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(controller.abort.bind(controller), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            controller.abort();
        }
        else {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    }
    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeoutId);
            signal?.removeEventListener("abort", onAbort);
        },
    };
}
