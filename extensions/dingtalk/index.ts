import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { dingtalkPlugin } from "./src/channel.js";
import { setDingTalkRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "dingtalk",
  name: "DingTalk Channel",
  description: "DingTalk (钉钉) messaging channel via Stream mode",
  plugin: dingtalkPlugin,
  configSchema: emptyPluginConfigSchema,
  setRuntime: setDingTalkRuntime,
});
