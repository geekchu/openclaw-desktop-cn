import { isPwAiLoaded } from "./pw-ai-state.js";
import { ensureExtensionRelayForProfiles, stopKnownBrowserProfiles } from "./server-lifecycle.js";
export async function createBrowserRuntimeState(params) {
    const state = {
        server: params.server ?? null,
        port: params.port,
        resolved: params.resolved,
        profiles: new Map(),
    };
    await ensureExtensionRelayForProfiles({
        resolved: params.resolved,
        onWarn: params.onWarn,
    });
    return state;
}
export async function stopBrowserRuntime(params) {
    if (!params.current) {
        return;
    }
    await stopKnownBrowserProfiles({
        getState: params.getState,
        onWarn: params.onWarn,
    });
    if (params.closeServer && params.current.server) {
        await new Promise((resolve) => {
            params.current?.server?.close(() => resolve());
        });
    }
    params.clearState();
    if (!isPwAiLoaded()) {
        return;
    }
    try {
        const mod = await import("./pw-ai.js");
        await mod.closePlaywrightBrowserConnection();
    }
    catch {
        // ignore
    }
}
