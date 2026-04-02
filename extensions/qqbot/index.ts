import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { qqbotPlugin } from "./src/channel.js";
import { setQQBotRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "qqbot",
  name: "QQ Bot",
  description: "QQ Bot channel plugin",
  plugin: qqbotPlugin,
  configSchema: emptyPluginConfigSchema,
  setRuntime: setQQBotRuntime,
});

export { qqbotPlugin } from "./src/channel.js";
export { setQQBotRuntime, getQQBotRuntime } from "./src/runtime.js";
export { qqbotOnboardingAdapter } from "./src/onboarding.js";
export * from "./src/types.js";
export * from "./src/api.js";
export * from "./src/config.js";
export * from "./src/gateway.js";
export * from "./src/outbound.js";
