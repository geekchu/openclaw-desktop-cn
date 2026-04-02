import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
const MATRIX_DEFAULT_ACCOUNT_AUTH_ONLY_FIELDS = new Set([
    "userId",
    "accessToken",
    "password",
    "deviceId",
]);
function resolveMatrixStringSourceValue(value) {
    return typeof value === "string" ? value : "";
}
function shouldAllowBaseAuthFallback(accountId, field) {
    return (normalizeAccountId(accountId) === DEFAULT_ACCOUNT_ID ||
        !MATRIX_DEFAULT_ACCOUNT_AUTH_ONLY_FIELDS.has(field));
}
export function resolveMatrixAccountStringValues(params) {
    const fields = [
        "homeserver",
        "userId",
        "accessToken",
        "password",
        "deviceId",
        "deviceName",
    ];
    const resolved = {};
    for (const field of fields) {
        resolved[field] =
            resolveMatrixStringSourceValue(params.account?.[field]) ||
                resolveMatrixStringSourceValue(params.scopedEnv?.[field]) ||
                (shouldAllowBaseAuthFallback(params.accountId, field)
                    ? resolveMatrixStringSourceValue(params.channel?.[field]) ||
                        resolveMatrixStringSourceValue(params.globalEnv?.[field])
                    : "");
    }
    return resolved;
}
