import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setFeishuRuntime, getRuntime: getFeishuRuntime } = createPluginRuntimeStore("Feishu runtime not initialized");
export { getFeishuRuntime, setFeishuRuntime };
