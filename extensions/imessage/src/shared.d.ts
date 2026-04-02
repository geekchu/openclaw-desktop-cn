import { type ChannelPlugin } from "../runtime-api.js";
import { type ResolvedIMessageAccount } from "./accounts.js";
export declare const IMESSAGE_CHANNEL: "imessage";
export declare const imessageSetupWizard: import("../../line/runtime-api.js").ChannelSetupWizard;
export declare const imessageConfigAdapter: {
    listAccountIds: (cfg: import("openclaw/plugin-sdk/core").OpenClawConfig) => string[];
    resolveAccount: (cfg: import("openclaw/plugin-sdk/core").OpenClawConfig, accountId?: string | null) => ResolvedIMessageAccount;
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
export declare const imessageSecurityAdapter: import("../../../dist/plugin-sdk/channel-runtime.js").ChannelSecurityAdapter<ResolvedIMessageAccount>;
export declare function createIMessagePluginBase(params: {
    setupWizard?: NonNullable<ChannelPlugin<ResolvedIMessageAccount>["setupWizard"]>;
    setup: NonNullable<ChannelPlugin<ResolvedIMessageAccount>["setup"]>;
}): Pick<ChannelPlugin<ResolvedIMessageAccount>, "id" | "meta" | "setupWizard" | "capabilities" | "reload" | "configSchema" | "config" | "security" | "setup">;
