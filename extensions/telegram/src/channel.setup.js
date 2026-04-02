import { telegramSetupAdapter } from "./setup-core.js";
import { telegramSetupWizard } from "./setup-surface.js";
import { createTelegramPluginBase } from "./shared.js";
export const telegramSetupPlugin = {
    ...createTelegramPluginBase({
        setupWizard: telegramSetupWizard,
        setup: telegramSetupAdapter,
    }),
};
