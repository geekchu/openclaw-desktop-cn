// Private runtime barrel for the bundled QQBot extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelPlugin,
  OpenClawConfig,
  OpenClawPluginApi,
  PluginRuntime,
  RuntimeEnv,
} from "openclaw/plugin-sdk";

export { applyAccountNameToChannelSection } from "../../src/channels/plugins/setup-helpers.js";
export {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "../../src/channels/plugins/config-helpers.js";

export type { ChannelSetupWizardAdapter as ChannelOnboardingAdapter } from "../../src/channels/plugins/setup-wizard-types.js";
