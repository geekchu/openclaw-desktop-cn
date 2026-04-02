import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setSynologyRuntime, getRuntime: getSynologyRuntime } = createPluginRuntimeStore("Synology Chat runtime not initialized - plugin not registered");
export { getSynologyRuntime, setSynologyRuntime };
