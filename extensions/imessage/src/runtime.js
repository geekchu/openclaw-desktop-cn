import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setIMessageRuntime, getRuntime: getIMessageRuntime } = createPluginRuntimeStore("iMessage runtime not initialized");
export { getIMessageRuntime, setIMessageRuntime };
