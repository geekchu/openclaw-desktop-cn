import { resolveEmbeddedSessionLane } from "../../../agents/pi-embedded.js";
import { clearCommandLane } from "../../../process/command-queue.js";
import { clearFollowupDrainCallback } from "./drain.js";
import { clearFollowupQueue } from "./state.js";
const defaultQueueCleanupDeps = {
    resolveEmbeddedSessionLane,
    clearCommandLane,
};
const queueCleanupDeps = {
    ...defaultQueueCleanupDeps,
};
export const __testing = {
    setDepsForTests(deps) {
        queueCleanupDeps.resolveEmbeddedSessionLane =
            deps?.resolveEmbeddedSessionLane ?? defaultQueueCleanupDeps.resolveEmbeddedSessionLane;
        queueCleanupDeps.clearCommandLane =
            deps?.clearCommandLane ?? defaultQueueCleanupDeps.clearCommandLane;
    },
    resetDepsForTests() {
        queueCleanupDeps.resolveEmbeddedSessionLane =
            defaultQueueCleanupDeps.resolveEmbeddedSessionLane;
        queueCleanupDeps.clearCommandLane = defaultQueueCleanupDeps.clearCommandLane;
    },
};
export function clearSessionQueues(keys) {
    const seen = new Set();
    let followupCleared = 0;
    let laneCleared = 0;
    const clearedKeys = [];
    for (const key of keys) {
        const cleaned = key?.trim();
        if (!cleaned || seen.has(cleaned)) {
            continue;
        }
        seen.add(cleaned);
        clearedKeys.push(cleaned);
        followupCleared += clearFollowupQueue(cleaned);
        clearFollowupDrainCallback(cleaned);
        laneCleared += queueCleanupDeps.clearCommandLane(queueCleanupDeps.resolveEmbeddedSessionLane(cleaned));
    }
    return { followupCleared, laneCleared, keys: clearedKeys };
}
