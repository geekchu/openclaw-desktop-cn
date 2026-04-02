import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const runtimeStore = createPluginRuntimeStore("BlueBubbles runtime not initialized");
export const setBlueBubblesRuntime = runtimeStore.setRuntime;
export function clearBlueBubblesRuntime() {
    runtimeStore.clearRuntime();
}
export function tryGetBlueBubblesRuntime() {
    return runtimeStore.tryGetRuntime();
}
export function getBlueBubblesRuntime() {
    return runtimeStore.getRuntime();
}
export function warnBlueBubbles(message) {
    const formatted = `[bluebubbles] ${message}`;
    // Backward-compatible with tests/legacy injections that pass { log }.
    const log = runtimeStore.tryGetRuntime()?.log;
    if (typeof log === "function") {
        log(formatted);
        return;
    }
    console.warn(formatted);
}
