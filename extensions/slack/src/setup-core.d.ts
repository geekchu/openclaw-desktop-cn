import { type OpenClawConfig } from "openclaw/plugin-sdk/setup";
import { type ChannelSetupAdapter, type ChannelSetupDmPolicy, type ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
export declare const slackSetupAdapter: ChannelSetupAdapter;
export declare function createSlackSetupWizardBase(handlers: {
    promptAllowFrom: NonNullable<ChannelSetupDmPolicy["promptAllowFrom"]>;
    resolveAllowFromEntries: NonNullable<NonNullable<ChannelSetupWizard["allowFrom"]>["resolveEntries"]>;
    resolveGroupAllowlist: NonNullable<NonNullable<NonNullable<ChannelSetupWizard["groupAccess"]>["resolveAllowlist"]>>;
}): {
    channel: "slack";
    status: import("../../../dist/plugin-sdk/src/channels/plugins/setup-wizard.js").ChannelSetupWizardStatus;
    introNote: {
        title: string;
        lines: string[];
        shouldShow: ({ cfg, accountId }: {
            cfg: OpenClawConfig;
            accountId: string;
            credentialValues: Partial<Record<string, string>>;
        }) => boolean;
    };
    envShortcut: {
        prompt: string;
        preferredEnvVar: string;
        isAvailable: ({ cfg, accountId }: {
            cfg: OpenClawConfig;
            accountId: string;
        }) => boolean;
        apply: ({ cfg, accountId }: {
            cfg: OpenClawConfig;
            accountId: string;
        }) => OpenClawConfig;
    };
    credentials: {
        inputKey: "botToken" | "appToken";
        providerHint: "slack-bot" | "slack-app";
        credentialLabel: string;
        preferredEnvVar: "SLACK_BOT_TOKEN" | "SLACK_APP_TOKEN";
        envPrompt: string;
        keepPrompt: string;
        inputPrompt: string;
        allowEnv: ({ accountId }: {
            accountId: string;
        }) => boolean;
        inspect: ({ cfg, accountId }: {
            cfg: OpenClawConfig;
            accountId: string;
        }) => {
            accountConfigured: boolean;
            hasConfiguredValue: boolean;
            resolvedValue: string | undefined;
            envValue: string | undefined;
        };
        applyUseEnv: ({ cfg, accountId }: {
            cfg: OpenClawConfig;
            accountId: string;
        }) => OpenClawConfig;
        applySet: ({ cfg, accountId, value, }: {
            cfg: OpenClawConfig;
            accountId: string;
            value: unknown;
        }) => OpenClawConfig;
    }[];
    dmPolicy: ChannelSetupDmPolicy;
    allowFrom: import("../../../dist/plugin-sdk/src/channels/plugins/setup-wizard.js").ChannelSetupWizardAllowFrom;
    groupAccess: import("../../../dist/plugin-sdk/src/channels/plugins/setup-wizard.js").ChannelSetupWizardGroupAccess;
    finalize: ({ cfg, accountId, options, prompter }: {
        cfg: OpenClawConfig;
        accountId: string;
        credentialValues: Partial<Record<string, string>>;
        runtime: import("../../../dist/plugin-sdk/src/channels/plugins/setup-wizard-types.js").ChannelSetupConfigureContext["runtime"];
        prompter: import("openclaw/plugin-sdk/setup").WizardPrompter;
        options?: import("../../../dist/plugin-sdk/src/channels/plugins/setup-wizard-types.js").ChannelSetupConfigureContext["options"];
        forceAllowFrom: boolean;
    }) => Promise<{
        cfg: OpenClawConfig;
    } | undefined>;
    disable: (cfg: OpenClawConfig) => OpenClawConfig;
};
export declare function createSlackSetupWizardProxy(loadWizard: () => Promise<{
    slackSetupWizard: ChannelSetupWizard;
}>): ChannelSetupWizard;
