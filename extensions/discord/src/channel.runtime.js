import { createDiscordSetupWizardProxy } from "./setup-core.js";
export const discordSetupWizard = createDiscordSetupWizardProxy(async () => (await import("./setup-surface.js")).discordSetupWizard);
