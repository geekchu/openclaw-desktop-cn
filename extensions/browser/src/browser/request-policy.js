export function normalizeBrowserRequestPath(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return trimmed;
    }
    const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (withLeadingSlash.length <= 1) {
        return withLeadingSlash;
    }
    return withLeadingSlash.replace(/\/+$/, "");
}
export function isPersistentBrowserProfileMutation(method, path) {
    const normalizedPath = normalizeBrowserRequestPath(path);
    if (method === "POST" &&
        (normalizedPath === "/profiles/create" || normalizedPath === "/reset-profile")) {
        return true;
    }
    return method === "DELETE" && /^\/profiles\/[^/]+$/.test(normalizedPath);
}
export function resolveRequestedBrowserProfile(params) {
    const queryProfile = typeof params.query?.profile === "string" ? params.query.profile.trim() : undefined;
    if (queryProfile) {
        return queryProfile;
    }
    if (params.body && typeof params.body === "object") {
        const bodyProfile = "profile" in params.body && typeof params.body.profile === "string"
            ? params.body.profile.trim()
            : undefined;
        if (bodyProfile) {
            return bodyProfile;
        }
    }
    const explicitProfile = typeof params.profile === "string" ? params.profile.trim() : undefined;
    return explicitProfile || undefined;
}
