export declare const GENERATED_BUNDLED_CHANNEL_ENTRIES: readonly [{
    readonly id: "bluebubbles";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/bluebubbles/src/accounts.js").ResolvedBlueBubblesAccount, import("../../extensions/bluebubbles/src/probe.js").BlueBubblesProbe>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/bluebubbles/src/accounts.js").ResolvedBlueBubblesAccount>;
    };
}, {
    readonly id: "discord";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/discord-surface.js").ResolvedDiscordAccount, import("../plugin-sdk/discord-surface.js").DiscordProbe>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/discord-surface.js").ResolvedDiscordAccount>;
    };
}, {
    readonly id: "feishu";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/feishu/src/types.js").ResolvedFeishuAccount, import("../../extensions/feishu/src/types.js").FeishuProbeResult>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/feishu/src/types.js").ResolvedFeishuAccount, import("../../extensions/feishu/src/types.js").FeishuProbeResult>;
    };
}, {
    readonly id: "imessage";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/imessage/api.js").ResolvedIMessageAccount, import("../plugin-sdk/imessage-runtime.js").IMessageProbe>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/imessage/api.js").ResolvedIMessageAccount>;
    };
}, {
    readonly id: "irc";
    readonly entry: any;
    readonly setupEntry: any;
}, {
    readonly id: "line";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/line-surface.js").ResolvedLineAccount>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/line-surface.js").ResolvedLineAccount>;
    };
}, {
    readonly id: "mattermost";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/mattermost/src/mattermost/accounts.js").ResolvedMattermostAccount>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/mattermost/src/mattermost/accounts.js").ResolvedMattermostAccount>;
    };
}, {
    readonly id: "nextcloud-talk";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/nextcloud-talk/src/accounts.js").ResolvedNextcloudTalkAccount>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/nextcloud-talk/src/accounts.js").ResolvedNextcloudTalkAccount>;
    };
}, {
    readonly id: "signal";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/signal-surface.js").ResolvedSignalAccount, import("../plugin-sdk/signal-surface.js").SignalProbe>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/signal-surface.js").ResolvedSignalAccount>;
    };
}, {
    readonly id: "slack";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/slack-surface.js").ResolvedSlackAccount, import("../plugin-sdk/slack-surface.js").SlackProbe>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/slack-surface.js").ResolvedSlackAccount>;
    };
}, {
    readonly id: "synology-chat";
    readonly entry: any;
    readonly setupEntry: any;
}, {
    readonly id: "telegram";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../plugin-sdk/telegram-surface.js").ResolvedTelegramAccount, import("../plugin-sdk/telegram-surface.js").TelegramProbe>;
    };
}, {
    readonly id: "zalo";
    readonly entry: {
        id: string;
        name: string;
        description: string;
        configSchema: import("../../dist/plugin-sdk/core.js").OpenClawPluginConfigSchema;
        register: (api: import("../../dist/plugin-sdk/core.js").OpenClawPluginApi) => void;
        channelPlugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/zalo/src/types.js").ResolvedZaloAccount, import("../../extensions/zalo/src/probe.js").ZaloProbeResult>;
        setChannelRuntime?: (runtime: import("../../dist/plugin-sdk/core.js").PluginRuntime) => void;
    };
    readonly setupEntry: {
        plugin: import("../../dist/plugin-sdk/discord-core.js").ChannelPlugin<import("../../extensions/zalo/src/types.js").ResolvedZaloAccount, import("../../extensions/zalo/src/probe.js").ZaloProbeResult>;
    };
}];
