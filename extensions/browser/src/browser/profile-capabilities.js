export function getBrowserProfileCapabilities(profile) {
    if (profile.driver === "existing-session") {
        return {
            mode: "local-existing-session",
            isRemote: false,
            usesChromeMcp: true,
            usesPersistentPlaywright: false,
            supportsPerTabWs: false,
            supportsJsonTabEndpoints: false,
            supportsReset: false,
            supportsManagedTabLimit: false,
        };
    }
    if (!profile.cdpIsLoopback) {
        return {
            mode: "remote-cdp",
            isRemote: true,
            usesChromeMcp: false,
            usesPersistentPlaywright: true,
            supportsPerTabWs: false,
            supportsJsonTabEndpoints: false,
            supportsReset: false,
            supportsManagedTabLimit: false,
        };
    }
    return {
        mode: "local-managed",
        isRemote: false,
        usesChromeMcp: false,
        usesPersistentPlaywright: false,
        supportsPerTabWs: true,
        supportsJsonTabEndpoints: true,
        supportsReset: true,
        supportsManagedTabLimit: true,
    };
}
export function resolveDefaultSnapshotFormat(params) {
    if (params.explicitFormat) {
        return params.explicitFormat;
    }
    if (params.mode === "efficient") {
        return "ai";
    }
    const capabilities = getBrowserProfileCapabilities(params.profile);
    if (capabilities.mode === "local-existing-session") {
        return "ai";
    }
    return params.hasPlaywright ? "ai" : "aria";
}
export function shouldUsePlaywrightForScreenshot(params) {
    return !params.wsUrl || Boolean(params.ref) || Boolean(params.element);
}
export function shouldUsePlaywrightForAriaSnapshot(params) {
    return !params.wsUrl;
}
