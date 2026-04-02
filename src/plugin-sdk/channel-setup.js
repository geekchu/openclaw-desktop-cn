import { createOptionalChannelSetupAdapter, createOptionalChannelSetupWizard, } from "./optional-channel-setup.js";
export { DEFAULT_ACCOUNT_ID, createTopLevelChannelDmPolicy, formatDocsLink, setSetupChannelEnabled, splitSetupEntries, } from "./setup.js";
export { createOptionalChannelSetupAdapter, createOptionalChannelSetupWizard, } from "./optional-channel-setup.js";
/** Build both optional setup surfaces from one metadata object. */
export function createOptionalChannelSetupSurface(params) {
    return {
        setupAdapter: createOptionalChannelSetupAdapter(params),
        setupWizard: createOptionalChannelSetupWizard(params),
    };
}
