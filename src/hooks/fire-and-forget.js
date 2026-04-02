import { logVerbose } from "../globals.js";
export function fireAndForgetHook(task, label, logger = logVerbose) {
    void task.catch((err) => {
        logger(`${label}: ${String(err)}`);
    });
}
