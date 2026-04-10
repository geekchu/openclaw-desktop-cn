import { loadConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { onAgentEvent } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import { resetAnnounceQueuesForTests } from "./subagent-announce-queue.js";
import * as subagentAnnounceModule from "./subagent-announce.js";
import { SUBAGENT_ENDED_REASON_COMPLETE, SUBAGENT_ENDED_REASON_ERROR, SUBAGENT_ENDED_REASON_KILLED, } from "./subagent-lifecycle-events.js";
import { emitSubagentEndedHookOnce, resolveLifecycleOutcomeFromRunOutcome, } from "./subagent-registry-completion.js";
import { ANNOUNCE_EXPIRY_MS, MAX_ANNOUNCE_RETRY_COUNT, reconcileOrphanedRestoredRuns, reconcileOrphanedRun, resolveAnnounceRetryDelayMs, resolveSubagentRunOrphanReason, resolveSubagentSessionStatus, safeRemoveAttachmentsDir, } from "./subagent-registry-helpers.js";
import { createSubagentRegistryLifecycleController } from "./subagent-registry-lifecycle.js";
import { subagentRuns } from "./subagent-registry-memory.js";
import { countActiveDescendantRunsFromRuns, countActiveRunsForSessionFromRuns, countPendingDescendantRunsExcludingRunFromRuns, countPendingDescendantRunsFromRuns, findRunIdsByChildSessionKeyFromRuns, listRunsForControllerFromRuns, listDescendantRunsForRequesterFromRuns, listRunsForRequesterFromRuns, resolveRequesterForChildSessionFromRuns, shouldIgnorePostCompletionAnnounceForSessionFromRuns, } from "./subagent-registry-queries.js";
import { createSubagentRunManager } from "./subagent-registry-run-manager.js";
import { getSubagentRunsSnapshotForRead, persistSubagentRunsToDisk, restoreSubagentRunsFromDisk, } from "./subagent-registry-state.js";
import { resolveAgentTimeoutMs } from "./timeout.js";
export { getSubagentSessionRuntimeMs, getSubagentSessionStartedAt, resolveSubagentSessionStatus, } from "./subagent-registry-helpers.js";
const log = createSubsystemLogger("agents/subagent-registry");
const defaultSubagentRegistryDeps = {
    callGateway,
    captureSubagentCompletionReply: (sessionKey) => subagentAnnounceModule.captureSubagentCompletionReply(sessionKey),
    getSubagentRunsSnapshotForRead,
    loadConfig,
    onAgentEvent,
    persistSubagentRunsToDisk,
    resolveAgentTimeoutMs,
    restoreSubagentRunsFromDisk,
    runSubagentAnnounceFlow: (params) => subagentAnnounceModule.runSubagentAnnounceFlow(params),
};
let subagentRegistryDeps = defaultSubagentRegistryDeps;
let subagentRegistryRuntimePromise = null;
let sweeper = null;
let listenerStarted = false;
let listenerStop = null;
// Use var to avoid TDZ when init runs across circular imports during bootstrap.
var restoreAttempted = false;
const ORPHAN_RECOVERY_DEBOUNCE_MS = 1_000;
let lastOrphanRecoveryScheduleAt = 0;
const SUBAGENT_ANNOUNCE_TIMEOUT_MS = 120_000;
/**
 * Embedded runs can emit transient lifecycle `error` events while provider/model
 * retry is still in progress. Defer terminal error cleanup briefly so a
 * subsequent lifecycle `start` / `end` can cancel premature failure announces.
 */
const LIFECYCLE_ERROR_RETRY_GRACE_MS = 15_000;
function loadSubagentRegistryRuntime() {
    subagentRegistryRuntimePromise ??= import("./subagent-registry.runtime.js");
    return subagentRegistryRuntimePromise;
}
async function ensureSubagentRegistryPluginRuntimeLoaded(params) {
    const ensureRuntimePluginsLoaded = subagentRegistryDeps.ensureRuntimePluginsLoaded;
    if (ensureRuntimePluginsLoaded) {
        ensureRuntimePluginsLoaded(params);
        return;
    }
    const runtime = await loadSubagentRegistryRuntime();
    runtime.ensureRuntimePluginsLoaded(params);
}
async function resolveSubagentRegistryContextEngine(cfg) {
    const runtime = await loadSubagentRegistryRuntime();
    const ensureContextEnginesInitialized = subagentRegistryDeps.ensureContextEnginesInitialized ?? runtime.ensureContextEnginesInitialized;
    const resolveContextEngine = subagentRegistryDeps.resolveContextEngine ?? runtime.resolveContextEngine;
    ensureContextEnginesInitialized();
    return await resolveContextEngine(cfg);
}
function persistSubagentRuns() {
    subagentRegistryDeps.persistSubagentRunsToDisk(subagentRuns);
}
export function scheduleSubagentOrphanRecovery(params) {
    const now = Date.now();
    if (now - lastOrphanRecoveryScheduleAt < ORPHAN_RECOVERY_DEBOUNCE_MS) {
        return;
    }
    lastOrphanRecoveryScheduleAt = now;
    void import("./subagent-orphan-recovery.js").then(({ scheduleOrphanRecovery }) => {
        scheduleOrphanRecovery({
            getActiveRuns: () => subagentRuns,
            delayMs: params?.delayMs,
            maxRetries: params?.maxRetries,
        });
    }, () => {
        // Ignore import failures — orphan recovery is best-effort.
    });
}
const resumedRuns = new Set();
const endedHookInFlightRunIds = new Set();
const pendingLifecycleErrorByRunId = new Map();
function clearPendingLifecycleError(runId) {
    const pending = pendingLifecycleErrorByRunId.get(runId);
    if (!pending) {
        return;
    }
    clearTimeout(pending.timer);
    pendingLifecycleErrorByRunId.delete(runId);
}
function clearAllPendingLifecycleErrors() {
    for (const pending of pendingLifecycleErrorByRunId.values()) {
        clearTimeout(pending.timer);
    }
    pendingLifecycleErrorByRunId.clear();
}
function schedulePendingLifecycleError(params) {
    clearPendingLifecycleError(params.runId);
    const timer = setTimeout(() => {
        const pending = pendingLifecycleErrorByRunId.get(params.runId);
        if (!pending || pending.timer !== timer) {
            return;
        }
        pendingLifecycleErrorByRunId.delete(params.runId);
        const entry = subagentRuns.get(params.runId);
        if (!entry) {
            return;
        }
        if (entry.endedReason === SUBAGENT_ENDED_REASON_COMPLETE || entry.outcome?.status === "ok") {
            return;
        }
        void completeSubagentRun({
            runId: params.runId,
            endedAt: pending.endedAt,
            outcome: {
                status: "error",
                error: pending.error,
            },
            reason: SUBAGENT_ENDED_REASON_ERROR,
            sendFarewell: true,
            accountId: entry.requesterOrigin?.accountId,
            triggerCleanup: true,
        });
    }, LIFECYCLE_ERROR_RETRY_GRACE_MS);
    timer.unref?.();
    pendingLifecycleErrorByRunId.set(params.runId, {
        timer,
        endedAt: params.endedAt,
        error: params.error,
    });
}
async function notifyContextEngineSubagentEnded(params) {
    try {
        const cfg = subagentRegistryDeps.loadConfig();
        await ensureSubagentRegistryPluginRuntimeLoaded({
            config: cfg,
            workspaceDir: params.workspaceDir,
            allowGatewaySubagentBinding: true,
        });
        const engine = await resolveSubagentRegistryContextEngine(cfg);
        if (!engine.onSubagentEnded) {
            return;
        }
        await engine.onSubagentEnded(params);
    }
    catch (err) {
        log.warn("context-engine onSubagentEnded failed (best-effort)", { err });
    }
}
function suppressAnnounceForSteerRestart(entry) {
    return entry?.suppressAnnounceReason === "steer-restart";
}
function shouldKeepThreadBindingAfterRun(params) {
    if (params.reason === SUBAGENT_ENDED_REASON_KILLED) {
        return false;
    }
    return params.entry.spawnMode === "session";
}
function shouldEmitEndedHookForRun(params) {
    return !shouldKeepThreadBindingAfterRun(params);
}
async function emitSubagentEndedHookForRun(params) {
    const cfg = subagentRegistryDeps.loadConfig();
    await ensureSubagentRegistryPluginRuntimeLoaded({
        config: cfg,
        workspaceDir: params.entry.workspaceDir,
        allowGatewaySubagentBinding: true,
    });
    const reason = params.reason ?? params.entry.endedReason ?? SUBAGENT_ENDED_REASON_COMPLETE;
    const outcome = resolveLifecycleOutcomeFromRunOutcome(params.entry.outcome);
    const error = params.entry.outcome?.status === "error" ? params.entry.outcome.error : undefined;
    await emitSubagentEndedHookOnce({
        entry: params.entry,
        reason,
        sendFarewell: params.sendFarewell,
        accountId: params.accountId ?? params.entry.requesterOrigin?.accountId,
        outcome,
        error,
        inFlightRunIds: endedHookInFlightRunIds,
        persist: persistSubagentRuns,
    });
}
const subagentLifecycleController = createSubagentRegistryLifecycleController({
    runs: subagentRuns,
    resumedRuns,
    subagentAnnounceTimeoutMs: SUBAGENT_ANNOUNCE_TIMEOUT_MS,
    persist: persistSubagentRuns,
    clearPendingLifecycleError,
    countPendingDescendantRuns,
    suppressAnnounceForSteerRestart,
    shouldEmitEndedHookForRun,
    emitSubagentEndedHookForRun,
    notifyContextEngineSubagentEnded,
    resumeSubagentRun,
    captureSubagentCompletionReply: (sessionKey) => subagentRegistryDeps.captureSubagentCompletionReply(sessionKey),
    runSubagentAnnounceFlow: (params) => subagentRegistryDeps.runSubagentAnnounceFlow(params),
    warn: (message, meta) => log.warn(message, meta),
});
const { completeCleanupBookkeeping, completeSubagentRun, finalizeResumedAnnounceGiveUp, refreshFrozenResultFromSession, startSubagentAnnounceCleanupFlow, } = subagentLifecycleController;
function resumeSubagentRun(runId) {
    if (!runId || resumedRuns.has(runId)) {
        return;
    }
    const entry = subagentRuns.get(runId);
    if (!entry) {
        return;
    }
    const orphanReason = resolveSubagentRunOrphanReason({ entry });
    if (orphanReason) {
        if (reconcileOrphanedRun({
            runId,
            entry,
            reason: orphanReason,
            source: "resume",
            runs: subagentRuns,
            resumedRuns,
        })) {
            persistSubagentRuns();
        }
        return;
    }
    if (entry.cleanupCompletedAt) {
        return;
    }
    // Skip entries that have exhausted their retry budget or expired (#18264).
    if ((entry.announceRetryCount ?? 0) >= MAX_ANNOUNCE_RETRY_COUNT) {
        void finalizeResumedAnnounceGiveUp({
            runId,
            entry,
            reason: "retry-limit",
        });
        return;
    }
    if (entry.expectsCompletionMessage !== true &&
        typeof entry.endedAt === "number" &&
        Date.now() - entry.endedAt > ANNOUNCE_EXPIRY_MS) {
        void finalizeResumedAnnounceGiveUp({
            runId,
            entry,
            reason: "expiry",
        });
        return;
    }
    const now = Date.now();
    const delayMs = resolveAnnounceRetryDelayMs(entry.announceRetryCount ?? 0);
    const earliestRetryAt = (entry.lastAnnounceRetryAt ?? 0) + delayMs;
    if (entry.expectsCompletionMessage === true &&
        entry.lastAnnounceRetryAt &&
        now < earliestRetryAt) {
        const waitMs = Math.max(1, earliestRetryAt - now);
        setTimeout(() => {
            resumedRuns.delete(runId);
            resumeSubagentRun(runId);
        }, waitMs).unref?.();
        resumedRuns.add(runId);
        return;
    }
    if (typeof entry.endedAt === "number" && entry.endedAt > 0) {
        if (suppressAnnounceForSteerRestart(entry)) {
            resumedRuns.add(runId);
            return;
        }
        if (!startSubagentAnnounceCleanupFlow(runId, entry)) {
            return;
        }
        resumedRuns.add(runId);
        return;
    }
    // Wait for completion again after restart.
    const cfg = subagentRegistryDeps.loadConfig();
    const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, entry.runTimeoutSeconds);
    void subagentRunManager.waitForSubagentCompletion(runId, waitTimeoutMs);
    resumedRuns.add(runId);
}
function restoreSubagentRunsOnce() {
    if (restoreAttempted) {
        return;
    }
    restoreAttempted = true;
    try {
        const restoredCount = subagentRegistryDeps.restoreSubagentRunsFromDisk({
            runs: subagentRuns,
            mergeOnly: true,
        });
        if (restoredCount === 0) {
            return;
        }
        if (reconcileOrphanedRestoredRuns({
            runs: subagentRuns,
            resumedRuns,
        })) {
            persistSubagentRuns();
        }
        if (subagentRuns.size === 0) {
            return;
        }
        // Resume pending work.
        ensureListener();
        if ([...subagentRuns.values()].some((entry) => entry.archiveAtMs)) {
            startSweeper();
        }
        for (const runId of subagentRuns.keys()) {
            resumeSubagentRun(runId);
        }
        // Cold-start restore path: queue the same recovery pass that restart
        // startup also uses so resumed children are handled through one seam.
        scheduleSubagentOrphanRecovery();
    }
    catch {
        // ignore restore failures
    }
}
function resolveSubagentWaitTimeoutMs(cfg, runTimeoutSeconds) {
    return subagentRegistryDeps.resolveAgentTimeoutMs({
        cfg,
        overrideSeconds: runTimeoutSeconds ?? 0,
    });
}
function startSweeper() {
    if (sweeper) {
        return;
    }
    sweeper = setInterval(() => {
        void sweepSubagentRuns();
    }, 60_000);
    sweeper.unref?.();
}
function stopSweeper() {
    if (!sweeper) {
        return;
    }
    clearInterval(sweeper);
    sweeper = null;
}
async function sweepSubagentRuns() {
    const now = Date.now();
    let mutated = false;
    for (const [runId, entry] of subagentRuns.entries()) {
        if (!entry.archiveAtMs || entry.archiveAtMs > now) {
            continue;
        }
        clearPendingLifecycleError(runId);
        void notifyContextEngineSubagentEnded({
            childSessionKey: entry.childSessionKey,
            reason: "swept",
            workspaceDir: entry.workspaceDir,
        });
        subagentRuns.delete(runId);
        mutated = true;
        // Archive/purge is terminal for the run record; remove any retained attachments too.
        await safeRemoveAttachmentsDir(entry);
        try {
            await subagentRegistryDeps.callGateway({
                method: "sessions.delete",
                params: {
                    key: entry.childSessionKey,
                    deleteTranscript: true,
                    emitLifecycleHooks: false,
                },
                timeoutMs: 10_000,
            });
        }
        catch {
            // ignore
        }
    }
    if (mutated) {
        persistSubagentRuns();
    }
    if (subagentRuns.size === 0) {
        stopSweeper();
    }
}
function ensureListener() {
    if (listenerStarted) {
        return;
    }
    listenerStarted = true;
    listenerStop = subagentRegistryDeps.onAgentEvent((evt) => {
        void (async () => {
            if (!evt || evt.stream !== "lifecycle") {
                return;
            }
            const phase = evt.data?.phase;
            const entry = subagentRuns.get(evt.runId);
            if (!entry) {
                if (phase === "end" && typeof evt.sessionKey === "string") {
                    await refreshFrozenResultFromSession(evt.sessionKey);
                }
                return;
            }
            if (phase === "start") {
                clearPendingLifecycleError(evt.runId);
                const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
                if (startedAt) {
                    entry.startedAt = startedAt;
                    if (typeof entry.sessionStartedAt !== "number") {
                        entry.sessionStartedAt = startedAt;
                    }
                    persistSubagentRuns();
                }
                return;
            }
            if (phase !== "end" && phase !== "error") {
                return;
            }
            const endedAt = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : Date.now();
            const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
            if (phase === "error") {
                schedulePendingLifecycleError({
                    runId: evt.runId,
                    endedAt,
                    error,
                });
                return;
            }
            clearPendingLifecycleError(evt.runId);
            const outcome = evt.data?.aborted
                ? { status: "timeout" }
                : { status: "ok" };
            await completeSubagentRun({
                runId: evt.runId,
                endedAt,
                outcome,
                reason: SUBAGENT_ENDED_REASON_COMPLETE,
                sendFarewell: true,
                accountId: entry.requesterOrigin?.accountId,
                triggerCleanup: true,
            });
        })();
    });
}
const subagentRunManager = createSubagentRunManager({
    runs: subagentRuns,
    resumedRuns,
    endedHookInFlightRunIds,
    persist: persistSubagentRuns,
    callGateway: (request) => subagentRegistryDeps.callGateway(request),
    loadConfig: () => subagentRegistryDeps.loadConfig(),
    ensureRuntimePluginsLoaded: (args) => ensureSubagentRegistryPluginRuntimeLoaded(args),
    ensureListener,
    startSweeper,
    stopSweeper,
    resumeSubagentRun,
    clearPendingLifecycleError,
    resolveSubagentWaitTimeoutMs,
    notifyContextEngineSubagentEnded,
    completeCleanupBookkeeping,
    completeSubagentRun,
});
export function markSubagentRunForSteerRestart(runId) {
    return subagentRunManager.markSubagentRunForSteerRestart(runId);
}
export function clearSubagentRunSteerRestart(runId) {
    return subagentRunManager.clearSubagentRunSteerRestart(runId);
}
export function replaceSubagentRunAfterSteer(params) {
    return subagentRunManager.replaceSubagentRunAfterSteer(params);
}
export function registerSubagentRun(params) {
    subagentRunManager.registerSubagentRun(params);
}
export function resetSubagentRegistryForTests(opts) {
    subagentRuns.clear();
    resumedRuns.clear();
    endedHookInFlightRunIds.clear();
    clearAllPendingLifecycleErrors();
    subagentRegistryRuntimePromise = null;
    resetAnnounceQueuesForTests();
    stopSweeper();
    restoreAttempted = false;
    if (listenerStop) {
        listenerStop();
        listenerStop = null;
    }
    listenerStarted = false;
    if (opts?.persist !== false) {
        persistSubagentRuns();
    }
}
export const __testing = {
    setDepsForTest(overrides) {
        subagentRegistryDeps = overrides
            ? {
                ...defaultSubagentRegistryDeps,
                ...overrides,
            }
            : defaultSubagentRegistryDeps;
    },
};
export function addSubagentRunForTests(entry) {
    subagentRuns.set(entry.runId, entry);
}
export function releaseSubagentRun(runId) {
    subagentRunManager.releaseSubagentRun(runId);
}
function findRunIdsByChildSessionKey(childSessionKey) {
    return findRunIdsByChildSessionKeyFromRuns(subagentRuns, childSessionKey);
}
export function resolveRequesterForChildSession(childSessionKey) {
    const resolved = resolveRequesterForChildSessionFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), childSessionKey);
    if (!resolved) {
        return null;
    }
    return {
        requesterSessionKey: resolved.requesterSessionKey,
        requesterOrigin: normalizeDeliveryContext(resolved.requesterOrigin),
    };
}
export function isSubagentSessionRunActive(childSessionKey) {
    const runIds = findRunIdsByChildSessionKey(childSessionKey);
    let latest;
    for (const runId of runIds) {
        const entry = subagentRuns.get(runId);
        if (!entry) {
            continue;
        }
        if (!latest || entry.createdAt > latest.createdAt) {
            latest = entry;
        }
    }
    return Boolean(latest && typeof latest.endedAt !== "number");
}
export function shouldIgnorePostCompletionAnnounceForSession(childSessionKey) {
    return shouldIgnorePostCompletionAnnounceForSessionFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), childSessionKey);
}
export function markSubagentRunTerminated(params) {
    return subagentRunManager.markSubagentRunTerminated(params);
}
export function listSubagentRunsForRequester(requesterSessionKey, options) {
    return listRunsForRequesterFromRuns(subagentRuns, requesterSessionKey, options);
}
export function listSubagentRunsForController(controllerSessionKey) {
    return listRunsForControllerFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), controllerSessionKey);
}
export function countActiveRunsForSession(requesterSessionKey) {
    return countActiveRunsForSessionFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), requesterSessionKey);
}
export function countActiveDescendantRuns(rootSessionKey) {
    return countActiveDescendantRunsFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), rootSessionKey);
}
export function countPendingDescendantRuns(rootSessionKey) {
    return countPendingDescendantRunsFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), rootSessionKey);
}
export function countPendingDescendantRunsExcludingRun(rootSessionKey, excludeRunId) {
    return countPendingDescendantRunsExcludingRunFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), rootSessionKey, excludeRunId);
}
export function listDescendantRunsForRequester(rootSessionKey) {
    return listDescendantRunsForRequesterFromRuns(subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns), rootSessionKey);
}
export function getSubagentRunByChildSessionKey(childSessionKey) {
    const key = childSessionKey.trim();
    if (!key) {
        return null;
    }
    let latestActive = null;
    let latestEnded = null;
    for (const entry of subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns).values()) {
        if (entry.childSessionKey !== key) {
            continue;
        }
        if (typeof entry.endedAt !== "number") {
            if (!latestActive || entry.createdAt > latestActive.createdAt) {
                latestActive = entry;
            }
            continue;
        }
        if (!latestEnded || entry.createdAt > latestEnded.createdAt) {
            latestEnded = entry;
        }
    }
    return latestActive ?? latestEnded;
}
export function getLatestSubagentRunByChildSessionKey(childSessionKey) {
    const key = childSessionKey.trim();
    if (!key) {
        return null;
    }
    let latest = null;
    for (const entry of subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns).values()) {
        if (entry.childSessionKey !== key) {
            continue;
        }
        if (!latest || entry.createdAt > latest.createdAt) {
            latest = entry;
        }
    }
    return latest;
}
export function initSubagentRegistry() {
    restoreSubagentRunsOnce();
}
