import fs from "node:fs";
import { BrowserResetUnsupportedError } from "./errors.js";
import { getBrowserProfileCapabilities } from "./profile-capabilities.js";
import { movePathToTrash } from "./trash.js";
async function closePlaywrightBrowserConnectionForProfile(cdpUrl) {
    try {
        const mod = await import("./pw-ai.js");
        await mod.closePlaywrightBrowserConnection(cdpUrl ? { cdpUrl } : undefined);
    }
    catch {
        // ignore
    }
}
export function createProfileResetOps({ profile, getProfileState, stopRunningBrowser, isHttpReachable, resolveOpenClawUserDataDir, }) {
    const capabilities = getBrowserProfileCapabilities(profile);
    const resetProfile = async () => {
        if (!capabilities.supportsReset) {
            throw new BrowserResetUnsupportedError(`reset-profile is only supported for local profiles (profile "${profile.name}" is remote).`);
        }
        const userDataDir = resolveOpenClawUserDataDir(profile.name);
        const profileState = getProfileState();
        const httpReachable = await isHttpReachable(300);
        if (httpReachable && !profileState.running) {
            // Port in use but not by us - kill it.
            await closePlaywrightBrowserConnectionForProfile(profile.cdpUrl);
        }
        if (profileState.running) {
            await stopRunningBrowser();
        }
        await closePlaywrightBrowserConnectionForProfile(profile.cdpUrl);
        if (!fs.existsSync(userDataDir)) {
            return { moved: false, from: userDataDir };
        }
        const moved = await movePathToTrash(userDataDir);
        return { moved: true, from: userDataDir, to: moved };
    };
    return { resetProfile };
}
