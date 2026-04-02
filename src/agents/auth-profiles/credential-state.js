import { coerceSecretRef, normalizeSecretInputString } from "../../config/types.secrets.js";
export function resolveTokenExpiryState(expires, now = Date.now()) {
    if (expires === undefined) {
        return "missing";
    }
    if (typeof expires !== "number") {
        return "invalid_expires";
    }
    if (!Number.isFinite(expires) || expires <= 0) {
        return "invalid_expires";
    }
    return now >= expires ? "expired" : "valid";
}
function hasConfiguredSecretRef(value) {
    return coerceSecretRef(value) !== null;
}
function hasConfiguredSecretString(value) {
    return normalizeSecretInputString(value) !== undefined;
}
export function evaluateStoredCredentialEligibility(params) {
    const now = params.now ?? Date.now();
    const credential = params.credential;
    if (credential.type === "api_key") {
        const hasKey = hasConfiguredSecretString(credential.key);
        const hasKeyRef = hasConfiguredSecretRef(credential.keyRef);
        if (!hasKey && !hasKeyRef) {
            return { eligible: false, reasonCode: "missing_credential" };
        }
        return { eligible: true, reasonCode: "ok" };
    }
    if (credential.type === "token") {
        const hasToken = hasConfiguredSecretString(credential.token);
        const hasTokenRef = hasConfiguredSecretRef(credential.tokenRef);
        if (!hasToken && !hasTokenRef) {
            return { eligible: false, reasonCode: "missing_credential" };
        }
        const expiryState = resolveTokenExpiryState(credential.expires, now);
        if (expiryState === "invalid_expires") {
            return { eligible: false, reasonCode: "invalid_expires" };
        }
        if (expiryState === "expired") {
            return { eligible: false, reasonCode: "expired" };
        }
        return { eligible: true, reasonCode: "ok" };
    }
    if (normalizeSecretInputString(credential.access) === undefined &&
        normalizeSecretInputString(credential.refresh) === undefined) {
        return { eligible: false, reasonCode: "missing_credential" };
    }
    return { eligible: true, reasonCode: "ok" };
}
