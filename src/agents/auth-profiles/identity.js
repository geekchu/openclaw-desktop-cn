function trimOptionalString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function resolveStoredMetadata(store, profileId) {
    const profile = store?.profiles[profileId];
    if (!profile) {
        return {};
    }
    return {
        displayName: "displayName" in profile ? trimOptionalString(profile.displayName) : undefined,
        email: "email" in profile ? trimOptionalString(profile.email) : undefined,
    };
}
export function buildAuthProfileId(params) {
    const profilePrefix = trimOptionalString(params.profilePrefix) ?? params.providerId;
    const profileName = trimOptionalString(params.profileName) ?? "default";
    return `${profilePrefix}:${profileName}`;
}
export function resolveAuthProfileMetadata(params) {
    const configured = params.cfg?.auth?.profiles?.[params.profileId];
    const stored = resolveStoredMetadata(params.store, params.profileId);
    return {
        displayName: trimOptionalString(configured?.displayName) ?? stored.displayName,
        email: trimOptionalString(configured?.email) ?? stored.email,
    };
}
