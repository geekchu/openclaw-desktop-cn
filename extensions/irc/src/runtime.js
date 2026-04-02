import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setIrcRuntime, getRuntime: getIrcRuntime } = createPluginRuntimeStore("IRC runtime not initialized");
export { getIrcRuntime, setIrcRuntime };
export function clearIrcRuntime() {
    setIrcRuntime(undefined);
}
