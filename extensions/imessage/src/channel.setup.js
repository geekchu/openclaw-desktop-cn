import { imessageSetupAdapter } from "./setup-core.js";
import { createIMessagePluginBase, imessageSetupWizard } from "./shared.js";
export const imessageSetupPlugin = {
    ...createIMessagePluginBase({
        setupWizard: imessageSetupWizard,
        setup: imessageSetupAdapter,
    }),
};
