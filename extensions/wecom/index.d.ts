declare const _default: {
  id: string;
  name: string;
  description: string;
  configSchema: import("openclaw/plugin-sdk/core").OpenClawPluginConfigSchema;
  register: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
  channelPlugin: import("openclaw/plugin-sdk/core").ChannelPlugin;
  setChannelRuntime?: (runtime: import("openclaw/plugin-sdk/core").PluginRuntime) => void;
};

export default _default;
export declare const register: (api: import("openclaw/plugin-sdk/core").OpenClawPluginApi) => void;
