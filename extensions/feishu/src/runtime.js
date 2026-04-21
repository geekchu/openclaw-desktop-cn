import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const runtimeStore = createPluginRuntimeStore("Feishu runtime not initialized");
export const setFeishuRuntime = runtimeStore.setRuntime;
export function clearFeishuRuntime() {
  runtimeStore.clearRuntime();
}
export function tryGetFeishuRuntime() {
  return runtimeStore.tryGetRuntime();
}
export function getFeishuRuntime() {
  return runtimeStore.getRuntime();
}
