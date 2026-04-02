import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setZaloRuntime, getRuntime: getZaloRuntime } = createPluginRuntimeStore("Zalo runtime not initialized");
export { getZaloRuntime, setZaloRuntime };
