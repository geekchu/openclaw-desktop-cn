import { callBrowserResize } from "./browser-cli-shared.js";
import { danger, defaultRuntime } from "./core-api.js";
export async function runBrowserResizeWithOutput(params) {
    const { width, height } = params;
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        defaultRuntime.error(danger("width and height must be numbers"));
        defaultRuntime.exit(1);
        return;
    }
    const result = await callBrowserResize(params.parent, {
        profile: params.profile,
        width,
        height,
        targetId: params.targetId,
    }, { timeoutMs: params.timeoutMs ?? 20000 });
    if (params.parent?.json) {
        defaultRuntime.writeJson(result);
        return;
    }
    defaultRuntime.log(params.successMessage);
}
