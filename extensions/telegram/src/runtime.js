import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
const { setRuntime: setTelegramRuntime, clearRuntime: clearTelegramRuntime, getRuntime: getTelegramRuntime, } = createPluginRuntimeStore("Telegram runtime not initialized");
export { clearTelegramRuntime, getTelegramRuntime, setTelegramRuntime };
