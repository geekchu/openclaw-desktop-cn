import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setSlackRuntime, clearRuntime: clearSlackRuntime, getRuntime: getSlackRuntime, } = createPluginRuntimeStore("Slack runtime not initialized");
export { clearSlackRuntime, getSlackRuntime, setSlackRuntime };
