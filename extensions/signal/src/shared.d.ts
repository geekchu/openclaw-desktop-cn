import { type ResolvedSignalAccount } from "./accounts.js";
import { type ChannelPlugin } from "./runtime-api.js";
export declare const SIGNAL_CHANNEL: "signal";
export declare const signalSetupWizard: import("../../line/runtime-api.js").ChannelSetupWizard;
export declare const signalConfigAdapter: {
    listAccountIds: (cfg: import("openclaw/plugin-sdk/core").OpenClawConfig) => string[];
    resolveAccount: (cfg: import("openclaw/plugin-sdk/core").OpenClawConfig, accountId?: string | null) => ResolvedSignalAccount;
    resolveAllowFrom?: ((params: {
        cfg: import("openclaw/plugin-sdk/core").OpenClawConfig;
        accountId?: string | null;
    }) => Array<string | number> | undefined) | undefined;
    inspectAccount?: ((cfg: import("openclaw/plugin-sdk/core").OpenClawConfig, accountId?: string | null) => unknown) | undefined;
    defaultAccountId?: ((cfg: import("openclaw/plugin-sdk/core").OpenClawConfig) => string) | undefined;
    setAccountEnabled?: ((params: {
        cfg: import("openclaw/plugin-sdk/core").OpenClawConfig;
        accountId: string;
        enabled: boolean;
    }) => import("openclaw/plugin-sdk/core").OpenClawConfig) | undefined;
    deleteAccount?: ((params: {
        cfg: import("openclaw/plugin-sdk/core").OpenClawConfig;
        accountId: string;
    }) => import("openclaw/plugin-sdk/core").OpenClawConfig) | undefined;
    formatAllowFrom?: ((params: {
        cfg: import("openclaw/plugin-sdk/core").OpenClawConfig;
        accountId?: string | null;
        allowFrom: Array<string | number>;
    }) => string[]) | undefined;
    resolveDefaultTo?: ((params: {
        cfg: import("openclaw/plugin-sdk/core").OpenClawConfig;
        accountId?: string | null;
    }) => string | undefined) | undefined;
};
export declare const signalSecurityAdapter: import("../../../dist/plugin-sdk/channel-runtime.js").ChannelSecurityAdapter<ResolvedSignalAccount>;
export declare function createSignalPluginBase(params: {
    setupWizard?: NonNullable<ChannelPlugin<ResolvedSignalAccount>["setupWizard"]>;
    setup: NonNullable<ChannelPlugin<ResolvedSignalAccount>["setup"]>;
}): Pick<ChannelPlugin<ResolvedSignalAccount>, "id" | "meta" | "setupWizard" | "capabilities" | "streaming" | "reload" | "configSchema" | "config" | "security" | "setup">;
