import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setSlackRuntime, clearRuntime: clearSlackRuntime, tryGetRuntime: getOptionalSlackRuntime, getRuntime: getSlackRuntime, } = createPluginRuntimeStore("Slack runtime not initialized");
export { clearSlackRuntime, getOptionalSlackRuntime, getSlackRuntime, setSlackRuntime };
