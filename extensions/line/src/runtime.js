import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setLineRuntime, clearRuntime: clearLineRuntime, getRuntime: getLineRuntime, } = createPluginRuntimeStore("LINE runtime not initialized - plugin not registered");
export { clearLineRuntime, getLineRuntime, setLineRuntime };
