import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
export function resolveProfileOverride(params) {
    const raw = params.rawProfile?.trim();
    if (!raw) {
        return {};
    }
    const store = ensureAuthProfileStore(params.agentDir, {
        allowKeychainPrompt: false,
    });
    const profile = store.profiles[raw];
    if (!profile) {
        return { error: `Auth profile "${raw}" not found.` };
    }
    if (profile.provider !== params.provider) {
        return {
            error: `Auth profile "${raw}" is for ${profile.provider}, not ${params.provider}.`,
        };
    }
    return { profileId: raw };
}
