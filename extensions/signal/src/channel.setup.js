import { signalSetupAdapter } from "./setup-core.js";
import { createSignalPluginBase, signalSetupWizard } from "./shared.js";
export const signalSetupPlugin = {
    ...createSignalPluginBase({
        setupWizard: signalSetupWizard,
        setup: signalSetupAdapter,
    }),
};
