export { imessagePlugin } from "./src/channel.js";
export { setIMessageRuntime } from "./src/runtime.js";
declare const _default: {
    id: string;
    name: string;
    description: string;
    configSchema: import("openclaw/plugin-sdk/core").OpenClawPluginConfigSchema;
    register: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
    channelPlugin: import("openclaw/plugin-sdk/core").ChannelPlugin<import("./api.js").ResolvedIMessageAccount, import("./runtime-api.js").IMessageProbe>;
    setChannelRuntime?: (runtime: import("openclaw/plugin-sdk/core").PluginRuntime) => void;
};
export default _default;
