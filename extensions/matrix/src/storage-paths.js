import crypto from "node:crypto";
import path from "node:path";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
export function sanitizeMatrixPathSegment(value) {
    const cleaned = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return cleaned || "unknown";
}
export function resolveMatrixHomeserverKey(homeserver) {
    try {
        const url = new URL(homeserver);
        if (url.host) {
            return sanitizeMatrixPathSegment(url.host);
        }
    }
    catch {
        // fall through
    }
    return sanitizeMatrixPathSegment(homeserver);
}
export function hashMatrixAccessToken(accessToken) {
    return crypto.createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
}
export function resolveMatrixCredentialsFilename(accountId) {
    const normalized = normalizeAccountId(accountId);
    return normalized === DEFAULT_ACCOUNT_ID ? "credentials.json" : `credentials-${normalized}.json`;
}
export function resolveMatrixCredentialsDir(stateDir) {
    return path.join(stateDir, "credentials", "matrix");
}
export function resolveMatrixCredentialsPath(params) {
    return path.join(resolveMatrixCredentialsDir(params.stateDir), resolveMatrixCredentialsFilename(params.accountId));
}
export function resolveMatrixLegacyFlatStoreRoot(stateDir) {
    return path.join(stateDir, "matrix");
}
export function resolveMatrixLegacyFlatStoragePaths(stateDir) {
    const rootDir = resolveMatrixLegacyFlatStoreRoot(stateDir);
    return {
        rootDir,
        storagePath: path.join(rootDir, "bot-storage.json"),
        cryptoPath: path.join(rootDir, "crypto"),
    };
}
export function resolveMatrixAccountStorageRoot(params) {
    const accountKey = sanitizeMatrixPathSegment(params.accountId ?? DEFAULT_ACCOUNT_ID);
    const userKey = sanitizeMatrixPathSegment(params.userId);
    const serverKey = resolveMatrixHomeserverKey(params.homeserver);
    const tokenHash = hashMatrixAccessToken(params.accessToken);
    return {
        rootDir: path.join(params.stateDir, "matrix", "accounts", accountKey, `${serverKey}__${userKey}`, tokenHash),
        accountKey,
        tokenHash,
    };
}
