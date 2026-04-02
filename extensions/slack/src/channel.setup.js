import { slackSetupAdapter } from "./setup-core.js";
import { slackSetupWizard } from "./setup-surface.js";
import { createSlackPluginBase } from "./shared.js";
export const slackSetupPlugin = {
    ...createSlackPluginBase({
        setupWizard: slackSetupWizard,
        setup: slackSetupAdapter,
    }),
};
