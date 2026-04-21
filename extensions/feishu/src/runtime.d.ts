import type { PluginRuntime } from "../runtime-api.js";
declare const setFeishuRuntime: (next: PluginRuntime) => void;
declare const getFeishuRuntime: () => PluginRuntime;
export declare function clearFeishuRuntime(): void;
export declare function tryGetFeishuRuntime(): PluginRuntime | null;
export { getFeishuRuntime, setFeishuRuntime };
