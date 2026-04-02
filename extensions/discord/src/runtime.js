import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setDiscordRuntime, getRuntime: getDiscordRuntime } = createPluginRuntimeStore("Discord runtime not initialized");
export { getDiscordRuntime, setDiscordRuntime };
