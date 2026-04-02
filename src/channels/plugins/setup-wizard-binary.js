import { detectBinary as defaultDetectBinary } from "../../plugins/setup-binary.js";
export function createDetectedBinaryStatus(params) {
    const detectBinary = params.detectBinary ?? defaultDetectBinary;
    return {
        configuredLabel: params.configuredLabel,
        unconfiguredLabel: params.unconfiguredLabel,
        configuredHint: params.configuredHint,
        unconfiguredHint: params.unconfiguredHint,
        configuredScore: params.configuredScore,
        unconfiguredScore: params.unconfiguredScore,
        resolveConfigured: params.resolveConfigured,
        async resolveStatusLines({ cfg, configured }) {
            const binaryPath = params.resolveBinaryPath({ cfg });
            const detected = await detectBinary(binaryPath);
            return [
                `${params.channelLabel}: ${configured ? params.configuredLabel : params.unconfiguredLabel}`,
                `${params.binaryLabel}: ${detected ? "found" : "missing"} (${binaryPath})`,
            ];
        },
        async resolveSelectionHint({ cfg, }) {
            return (await detectBinary(params.resolveBinaryPath({ cfg })))
                ? params.configuredHint
                : params.unconfiguredHint;
        },
        async resolveQuickstartScore({ cfg, }) {
            return (await detectBinary(params.resolveBinaryPath({ cfg })))
                ? params.configuredScore
                : params.unconfiguredScore;
        },
    };
}
export function createCliPathTextInput(params) {
    return {
        inputKey: params.inputKey,
        message: params.message,
        currentValue: params.resolvePath,
        initialValue: params.resolvePath,
        shouldPrompt: params.shouldPrompt,
        confirmCurrentValue: false,
        applyCurrentValue: true,
        ...(params.helpTitle ? { helpTitle: params.helpTitle } : {}),
        ...(params.helpLines ? { helpLines: params.helpLines } : {}),
    };
}
export function createDelegatedSetupWizardStatusResolvers(loadWizard) {
    return {
        async resolveStatusLines(params) {
            return (await loadWizard()).status.resolveStatusLines?.(params) ?? [];
        },
        async resolveSelectionHint(params) {
            return await (await loadWizard()).status.resolveSelectionHint?.(params);
        },
        async resolveQuickstartScore(params) {
            return await (await loadWizard()).status.resolveQuickstartScore?.(params);
        },
    };
}
export function createDelegatedTextInputShouldPrompt(params) {
    return async (inputParams) => {
        const input = (await params.loadWizard()).textInputs?.find((entry) => entry.inputKey === params.inputKey);
        return (await input?.shouldPrompt?.(inputParams)) ?? false;
    };
}
