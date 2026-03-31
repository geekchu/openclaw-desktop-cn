// Private runtime barrel for the bundled DingTalk extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
  RuntimeEnv,
} from "openclaw/plugin-sdk";

export { buildChannelConfigSchema } from "../../src/channels/plugins/config-schema.js";
export { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../../src/routing/account-id.js";
export { formatDocsLink } from "../../src/terminal/links.js";
export type { ChannelSetupWizardAdapter as ChannelOnboardingAdapter } from "../../src/channels/plugins/setup-wizard-types.js";
