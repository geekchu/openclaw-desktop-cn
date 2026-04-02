import crypto from "node:crypto";
import { loadConfig } from "../config/config.js";
import { buildExecApprovalUnavailableReplyPayload } from "../infra/exec-approval-reply.js";
import { hasConfiguredExecApprovalDmRoute, resolveExecApprovalInitiatingSurfaceState, } from "../infra/exec-approval-surface.js";
import { maxAsk, minSecurity, resolveExecApprovals, } from "../infra/exec-approvals.js";
import { sendExecApprovalFollowup } from "./bash-tools.exec-approval-followup.js";
import { resolveRegisteredExecApprovalDecision, } from "./bash-tools.exec-approval-request.js";
import { buildApprovalPendingMessage } from "./bash-tools.exec-runtime.js";
import { DEFAULT_APPROVAL_TIMEOUT_MS } from "./bash-tools.exec-runtime.js";
export function createExecApprovalPendingState(params) {
    return {
        warningText: params.warnings.length ? `${params.warnings.join("\n")}\n\n` : "",
        expiresAtMs: Date.now() + params.timeoutMs,
        preResolvedDecision: undefined,
    };
}
export function createExecApprovalRequestState(params) {
    const pendingState = createExecApprovalPendingState({
        warnings: params.warnings,
        timeoutMs: params.timeoutMs,
    });
    return {
        ...pendingState,
        noticeSeconds: Math.max(1, Math.round(params.approvalRunningNoticeMs / 1000)),
    };
}
export function createExecApprovalRequestContext(params) {
    const approvalId = crypto.randomUUID();
    const pendingState = createExecApprovalRequestState({
        warnings: params.warnings,
        timeoutMs: params.timeoutMs,
        approvalRunningNoticeMs: params.approvalRunningNoticeMs,
    });
    return {
        ...pendingState,
        approvalId,
        approvalSlug: params.createApprovalSlug(approvalId),
        contextKey: `exec:${approvalId}`,
    };
}
export function createDefaultExecApprovalRequestContext(params) {
    return createExecApprovalRequestContext({
        warnings: params.warnings,
        timeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
        approvalRunningNoticeMs: params.approvalRunningNoticeMs,
        createApprovalSlug: params.createApprovalSlug,
    });
}
export function resolveBaseExecApprovalDecision(params) {
    if (params.decision === "deny") {
        return { approvedByAsk: false, deniedReason: "user-denied", timedOut: false };
    }
    if (!params.decision) {
        if (params.obfuscationDetected) {
            return {
                approvedByAsk: false,
                deniedReason: "approval-timeout (obfuscation-detected)",
                timedOut: true,
            };
        }
        if (params.askFallback === "full") {
            return { approvedByAsk: true, deniedReason: null, timedOut: true };
        }
        if (params.askFallback === "deny") {
            return { approvedByAsk: false, deniedReason: "approval-timeout", timedOut: true };
        }
        return { approvedByAsk: false, deniedReason: null, timedOut: true };
    }
    return { approvedByAsk: false, deniedReason: null, timedOut: false };
}
export function resolveExecHostApprovalContext(params) {
    const approvals = resolveExecApprovals(params.agentId, {
        security: params.security,
        ask: params.ask,
    });
    const hostSecurity = minSecurity(params.security, approvals.agent.security);
    // An explicit ask=off policy in exec-approvals.json must be able to suppress
    // prompts even when tool/runtime defaults are stricter (for example on-miss).
    const hostAsk = approvals.agent.ask === "off" ? "off" : maxAsk(params.ask, approvals.agent.ask);
    const askFallback = approvals.agent.askFallback;
    if (hostSecurity === "deny") {
        throw new Error(`exec denied: host=${params.host} security=deny`);
    }
    return { approvals, hostSecurity, hostAsk, askFallback };
}
export async function resolveApprovalDecisionOrUndefined(params) {
    try {
        return await resolveRegisteredExecApprovalDecision({
            approvalId: params.approvalId,
            preResolvedDecision: params.preResolvedDecision,
        });
    }
    catch {
        params.onFailure();
        return undefined;
    }
}
export function resolveExecApprovalUnavailableState(params) {
    const initiatingSurface = resolveExecApprovalInitiatingSurfaceState({
        channel: params.turnSourceChannel,
        accountId: params.turnSourceAccountId,
    });
    const sentApproverDms = (initiatingSurface.kind === "disabled" || initiatingSurface.kind === "unsupported") &&
        hasConfiguredExecApprovalDmRoute(loadConfig());
    const unavailableReason = params.preResolvedDecision === null
        ? "no-approval-route"
        : initiatingSurface.kind === "disabled"
            ? "initiating-platform-disabled"
            : initiatingSurface.kind === "unsupported"
                ? "initiating-platform-unsupported"
                : null;
    return {
        initiatingSurface,
        sentApproverDms,
        unavailableReason,
    };
}
export async function createAndRegisterDefaultExecApprovalRequest(params) {
    const { approvalId, approvalSlug, warningText, expiresAtMs: defaultExpiresAtMs, preResolvedDecision: defaultPreResolvedDecision, } = createDefaultExecApprovalRequestContext({
        warnings: params.warnings,
        approvalRunningNoticeMs: params.approvalRunningNoticeMs,
        createApprovalSlug: params.createApprovalSlug,
    });
    const registration = await params.register(approvalId);
    const preResolvedDecision = registration.finalDecision;
    const { initiatingSurface, sentApproverDms, unavailableReason } = resolveExecApprovalUnavailableState({
        turnSourceChannel: params.turnSourceChannel,
        turnSourceAccountId: params.turnSourceAccountId,
        preResolvedDecision,
    });
    return {
        approvalId,
        approvalSlug,
        warningText,
        expiresAtMs: registration.expiresAtMs ?? defaultExpiresAtMs,
        preResolvedDecision: registration.finalDecision === undefined
            ? defaultPreResolvedDecision
            : registration.finalDecision,
        initiatingSurface,
        sentApproverDms,
        unavailableReason,
    };
}
export function buildDefaultExecApprovalRequestArgs(params) {
    return {
        warnings: params.warnings,
        approvalRunningNoticeMs: params.approvalRunningNoticeMs,
        createApprovalSlug: params.createApprovalSlug,
        turnSourceChannel: params.turnSourceChannel,
        turnSourceAccountId: params.turnSourceAccountId,
    };
}
export function buildExecApprovalFollowupTarget(params) {
    return {
        approvalId: params.approvalId,
        sessionKey: params.sessionKey,
        turnSourceChannel: params.turnSourceChannel,
        turnSourceTo: params.turnSourceTo,
        turnSourceAccountId: params.turnSourceAccountId,
        turnSourceThreadId: params.turnSourceThreadId,
    };
}
export function createExecApprovalDecisionState(params) {
    const baseDecision = resolveBaseExecApprovalDecision({
        decision: params.decision ?? null,
        askFallback: params.askFallback,
        obfuscationDetected: params.obfuscationDetected,
    });
    return {
        baseDecision,
        approvedByAsk: baseDecision.approvedByAsk,
        deniedReason: baseDecision.deniedReason,
    };
}
export async function sendExecApprovalFollowupResult(target, resultText) {
    await sendExecApprovalFollowup({
        approvalId: target.approvalId,
        sessionKey: target.sessionKey,
        turnSourceChannel: target.turnSourceChannel,
        turnSourceTo: target.turnSourceTo,
        turnSourceAccountId: target.turnSourceAccountId,
        turnSourceThreadId: target.turnSourceThreadId,
        resultText,
    }).catch(() => { });
}
export function buildExecApprovalPendingToolResult(params) {
    return {
        content: [
            {
                type: "text",
                text: params.unavailableReason !== null
                    ? (buildExecApprovalUnavailableReplyPayload({
                        warningText: params.warningText,
                        reason: params.unavailableReason,
                        channelLabel: params.initiatingSurface.channelLabel,
                        sentApproverDms: params.sentApproverDms,
                    }).text ?? "")
                    : buildApprovalPendingMessage({
                        warningText: params.warningText,
                        approvalSlug: params.approvalSlug,
                        approvalId: params.approvalId,
                        command: params.command,
                        cwd: params.cwd,
                        host: params.host,
                        nodeId: params.nodeId,
                    }),
            },
        ],
        details: params.unavailableReason !== null
            ? {
                status: "approval-unavailable",
                reason: params.unavailableReason,
                channelLabel: params.initiatingSurface.channelLabel,
                sentApproverDms: params.sentApproverDms,
                host: params.host,
                command: params.command,
                cwd: params.cwd,
                nodeId: params.nodeId,
                warningText: params.warningText,
            }
            : {
                status: "approval-pending",
                approvalId: params.approvalId,
                approvalSlug: params.approvalSlug,
                expiresAtMs: params.expiresAtMs,
                host: params.host,
                command: params.command,
                cwd: params.cwd,
                nodeId: params.nodeId,
                warningText: params.warningText,
            },
    };
}
