import { subagentRuns } from "./subagent-registry-memory.js";
import { countActiveDescendantRunsFromRuns, listDescendantRunsForRequesterFromRuns, listRunsForControllerFromRuns, } from "./subagent-registry-queries.js";
import { getSubagentRunsSnapshotForRead } from "./subagent-registry-state.js";
import { getSubagentSessionRuntimeMs, getSubagentSessionStartedAt, resolveSubagentSessionStatus, } from "./subagent-session-metrics.js";
export { getSubagentSessionRuntimeMs, getSubagentSessionStartedAt, resolveSubagentSessionStatus, } from "./subagent-session-metrics.js";
export function listSubagentRunsForController(controllerSessionKey) {
    return listRunsForControllerFromRuns(getSubagentRunsSnapshotForRead(subagentRuns), controllerSessionKey);
}
export function countActiveDescendantRuns(rootSessionKey) {
    return countActiveDescendantRunsFromRuns(getSubagentRunsSnapshotForRead(subagentRuns), rootSessionKey);
}
export function listDescendantRunsForRequester(rootSessionKey) {
    return listDescendantRunsForRequesterFromRuns(getSubagentRunsSnapshotForRead(subagentRuns), rootSessionKey);
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
export function getSessionDisplaySubagentRunByChildSessionKey(childSessionKey) {
    const key = childSessionKey.trim();
    if (!key) {
        return null;
    }
    let latestInMemoryActive = null;
    let latestInMemoryEnded = null;
    for (const entry of subagentRuns.values()) {
        if (entry.childSessionKey !== key) {
            continue;
        }
        if (typeof entry.endedAt === "number") {
            if (!latestInMemoryEnded || entry.createdAt > latestInMemoryEnded.createdAt) {
                latestInMemoryEnded = entry;
            }
            continue;
        }
        if (!latestInMemoryActive || entry.createdAt > latestInMemoryActive.createdAt) {
            latestInMemoryActive = entry;
        }
    }
    if (latestInMemoryEnded || latestInMemoryActive) {
        if (latestInMemoryEnded &&
            (!latestInMemoryActive || latestInMemoryEnded.createdAt > latestInMemoryActive.createdAt)) {
            return latestInMemoryEnded;
        }
        return latestInMemoryActive ?? latestInMemoryEnded;
    }
    return getSubagentRunByChildSessionKey(key);
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
