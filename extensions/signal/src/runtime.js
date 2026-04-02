import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setSignalRuntime, clearRuntime: clearSignalRuntime, getRuntime: getSignalRuntime, } = createPluginRuntimeStore("Signal runtime not initialized");
export { clearSignalRuntime, getSignalRuntime, setSignalRuntime };
