import { SUBAGENT_ENDED_REASON_KILLED } from "./subagent-lifecycle-events.js";
import { subagentRuns } from "./subagent-registry-memory.js";
import { listRunsForControllerFromRuns } from "./subagent-registry-queries.js";
import { getSubagentRunsSnapshotForRead } from "./subagent-registry-state.js";
function resolveSubagentSessionStartedAt(entry) {
    if (typeof entry.sessionStartedAt === "number" && Number.isFinite(entry.sessionStartedAt)) {
        return entry.sessionStartedAt;
    }
    if (typeof entry.startedAt === "number" && Number.isFinite(entry.startedAt)) {
        return entry.startedAt;
    }
    return typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
        ? entry.createdAt
        : undefined;
}
export function getSubagentSessionStartedAt(entry) {
    return entry ? resolveSubagentSessionStartedAt(entry) : undefined;
}
export function getSubagentSessionRuntimeMs(entry, now = Date.now()) {
    if (!entry) {
        return undefined;
    }
    const accumulatedRuntimeMs = typeof entry.accumulatedRuntimeMs === "number" && Number.isFinite(entry.accumulatedRuntimeMs)
        ? Math.max(0, entry.accumulatedRuntimeMs)
        : 0;
    if (typeof entry.startedAt !== "number" || !Number.isFinite(entry.startedAt)) {
        return entry.accumulatedRuntimeMs != null ? accumulatedRuntimeMs : undefined;
    }
    const currentRunEndedAt = typeof entry.endedAt === "number" && Number.isFinite(entry.endedAt) ? entry.endedAt : now;
    return Math.max(0, accumulatedRuntimeMs + Math.max(0, currentRunEndedAt - entry.startedAt));
}
export function resolveSubagentSessionStatus(entry) {
    if (!entry) {
        return undefined;
    }
    if (!entry.endedAt) {
        return "running";
    }
    if (entry.endedReason === SUBAGENT_ENDED_REASON_KILLED) {
        return "killed";
    }
    const status = entry.outcome?.status;
    if (status === "error") {
        return "failed";
    }
    if (status === "timeout") {
        return "timeout";
    }
    return "done";
}
export function listSubagentRunsForController(controllerSessionKey) {
    return listRunsForControllerFromRuns(getSubagentRunsSnapshotForRead(subagentRuns), controllerSessionKey);
}
export function getSubagentRunByChildSessionKey(childSessionKey) {
    const key = childSessionKey.trim();
    if (!key) {
        return null;
    }
    let latestActive = null;
    let latestEnded = null;
    for (const entry of getSubagentRunsSnapshotForRead(subagentRuns).values()) {
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
    for (const entry of getSubagentRunsSnapshotForRead(subagentRuns).values()) {
        if (entry.childSessionKey !== key) {
            continue;
        }
        if (!latest || entry.createdAt > latest.createdAt) {
            latest = entry;
        }
    }
    return latest;
}
