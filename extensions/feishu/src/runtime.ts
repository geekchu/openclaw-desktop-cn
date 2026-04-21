import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "../runtime-api.js";

const runtimeStore = createPluginRuntimeStore<PluginRuntime>("Feishu runtime not initialized");

export const setFeishuRuntime = runtimeStore.setRuntime;

export function clearFeishuRuntime(): void {
  runtimeStore.clearRuntime();
}

export function tryGetFeishuRuntime(): PluginRuntime | null {
  return runtimeStore.tryGetRuntime();
}

export function getFeishuRuntime(): PluginRuntime {
  return runtimeStore.getRuntime();
}
