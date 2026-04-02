import { runHeartbeatOnce as runHeartbeatOnceInternal } from "../../infra/heartbeat-runner.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { formatNativeDependencyHint } from "./native-deps.js";
export function createRuntimeSystem() {
    return {
        enqueueSystemEvent,
        requestHeartbeatNow,
        runHeartbeatOnce: (opts) => {
            // Destructure to forward only the plugin-safe subset; prevent cfg/deps injection at runtime.
            const { reason, agentId, sessionKey, heartbeat } = opts ?? {};
            return runHeartbeatOnceInternal({
                reason,
                agentId,
                sessionKey,
                heartbeat: heartbeat ? { target: heartbeat.target } : undefined,
            });
        },
        runCommandWithTimeout,
        formatNativeDependencyHint,
    };
}
