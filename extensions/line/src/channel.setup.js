import { lineChannelPluginCommon } from "./channel-shared.js";
import { lineSetupAdapter } from "./setup-core.js";
import { lineSetupWizard } from "./setup-surface.js";
export const lineSetupPlugin = {
    id: "line",
    ...lineChannelPluginCommon,
    setupWizard: lineSetupWizard,
    setup: lineSetupAdapter,
};
