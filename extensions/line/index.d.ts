export { linePlugin } from "./src/channel.js";
export { setLineRuntime } from "./src/runtime.js";
declare const _default: {
    id: string;
    name: string;
    description: string;
    configSchema: import("openclaw/plugin-sdk/core").OpenClawPluginConfigSchema;
    register: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
    channelPlugin: import("openclaw/plugin-sdk/core").ChannelPlugin<import("./runtime-api.js").ResolvedLineAccount>;
    setChannelRuntime?: (runtime: import("openclaw/plugin-sdk/core").PluginRuntime) => void;
};
export default _default;
