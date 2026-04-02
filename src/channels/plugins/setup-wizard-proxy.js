import { createDelegatedSetupWizardStatusResolvers } from "./setup-wizard-binary.js";
export function createDelegatedResolveConfigured(loadWizard) {
    return async ({ cfg }) => await (await loadWizard()).status.resolveConfigured({ cfg });
}
export function createDelegatedPrepare(loadWizard) {
    return async (params) => await (await loadWizard()).prepare?.(params);
}
export function createDelegatedFinalize(loadWizard) {
    return async (params) => await (await loadWizard()).finalize?.(params);
}
export function createDelegatedSetupWizardProxy(params) {
    return {
        channel: params.channel,
        status: {
            ...params.status,
            resolveConfigured: createDelegatedResolveConfigured(params.loadWizard),
            ...createDelegatedSetupWizardStatusResolvers(params.loadWizard),
        },
        ...(params.resolveShouldPromptAccountIds
            ? { resolveShouldPromptAccountIds: params.resolveShouldPromptAccountIds }
            : {}),
        ...(params.delegatePrepare ? { prepare: createDelegatedPrepare(params.loadWizard) } : {}),
        credentials: params.credentials ?? [],
        ...(params.textInputs ? { textInputs: params.textInputs } : {}),
        ...(params.delegateFinalize ? { finalize: createDelegatedFinalize(params.loadWizard) } : {}),
        ...(params.completionNote ? { completionNote: params.completionNote } : {}),
        ...(params.dmPolicy ? { dmPolicy: params.dmPolicy } : {}),
        ...(params.disable ? { disable: params.disable } : {}),
        ...(params.onAccountRecorded ? { onAccountRecorded: params.onAccountRecorded } : {}),
    };
}
export function createAllowlistSetupWizardProxy(params) {
    return params.createBase({
        promptAllowFrom: async ({ cfg, prompter, accountId }) => {
            const wizard = await params.loadWizard();
            if (!wizard.dmPolicy?.promptAllowFrom) {
                return cfg;
            }
            return await wizard.dmPolicy.promptAllowFrom({ cfg, prompter, accountId });
        },
        resolveAllowFromEntries: async ({ cfg, accountId, credentialValues, entries }) => {
            const wizard = await params.loadWizard();
            if (!wizard.allowFrom) {
                return entries.map((input) => ({ input, resolved: false, id: null }));
            }
            return await wizard.allowFrom.resolveEntries({
                cfg,
                accountId,
                credentialValues,
                entries,
            });
        },
        resolveGroupAllowlist: async ({ cfg, accountId, credentialValues, entries, prompter }) => {
            const wizard = await params.loadWizard();
            if (!wizard.groupAccess?.resolveAllowlist) {
                return params.fallbackResolvedGroupAllowlist(entries);
            }
            return (await wizard.groupAccess.resolveAllowlist({
                cfg,
                accountId,
                credentialValues,
                entries,
                prompter,
            }));
        },
    });
}
