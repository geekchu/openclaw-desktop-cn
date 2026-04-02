import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { requiresExplicitMatrixDefaultAccount, resolveMatrixDefaultOrOnlyAccountId, } from "../account-selection.js";
import { getMatrixRuntime } from "../runtime.js";
import { resolveMatrixCredentialsDir as resolveSharedMatrixCredentialsDir, resolveMatrixCredentialsPath as resolveSharedMatrixCredentialsPath, } from "../storage-paths.js";
function resolveStateDir(env) {
    try {
        return getMatrixRuntime().state.resolveStateDir(env, os.homedir);
    }
    catch {
        // Some config-only helpers read stored credentials before the Matrix plugin
        // runtime is installed. Fall back to the standard state-dir env contract.
        const override = env.OPENCLAW_STATE_DIR?.trim();
        if (override) {
            return path.resolve(override);
        }
        const homeDir = env.OPENCLAW_HOME?.trim() || env.HOME?.trim() || os.homedir();
        return path.join(homeDir, ".openclaw");
    }
}
function resolveLegacyMatrixCredentialsPath(env) {
    return path.join(resolveMatrixCredentialsDir(env), "credentials.json");
}
function shouldReadLegacyCredentialsForAccount(accountId) {
    const normalizedAccountId = normalizeAccountId(accountId);
    const cfg = getMatrixRuntime().config.loadConfig();
    if (!cfg.channels?.matrix || typeof cfg.channels.matrix !== "object") {
        return normalizedAccountId === DEFAULT_ACCOUNT_ID;
    }
    if (requiresExplicitMatrixDefaultAccount(cfg)) {
        return false;
    }
    return normalizeAccountId(resolveMatrixDefaultOrOnlyAccountId(cfg)) === normalizedAccountId;
}
function resolveLegacyMigrationSourcePath(env, accountId) {
    if (!shouldReadLegacyCredentialsForAccount(accountId)) {
        return null;
    }
    const legacyPath = resolveLegacyMatrixCredentialsPath(env);
    return legacyPath === resolveMatrixCredentialsPath(env, accountId) ? null : legacyPath;
}
function parseMatrixCredentialsFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.homeserver !== "string" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.accessToken !== "string") {
        return null;
    }
    return parsed;
}
export function resolveMatrixCredentialsDir(env = process.env, stateDir) {
    const resolvedStateDir = stateDir ?? resolveStateDir(env);
    return resolveSharedMatrixCredentialsDir(resolvedStateDir);
}
export function resolveMatrixCredentialsPath(env = process.env, accountId) {
    const resolvedStateDir = resolveStateDir(env);
    return resolveSharedMatrixCredentialsPath({ stateDir: resolvedStateDir, accountId });
}
export function loadMatrixCredentials(env = process.env, accountId) {
    const credPath = resolveMatrixCredentialsPath(env, accountId);
    try {
        if (fs.existsSync(credPath)) {
            return parseMatrixCredentialsFile(credPath);
        }
        const legacyPath = resolveLegacyMigrationSourcePath(env, accountId);
        if (!legacyPath || !fs.existsSync(legacyPath)) {
            return null;
        }
        const parsed = parseMatrixCredentialsFile(legacyPath);
        if (!parsed) {
            return null;
        }
        try {
            fs.mkdirSync(path.dirname(credPath), { recursive: true });
            fs.renameSync(legacyPath, credPath);
        }
        catch {
            // Keep returning the legacy credentials even if migration fails.
        }
        return parsed;
    }
    catch {
        return null;
    }
}
export function clearMatrixCredentials(env = process.env, accountId) {
    const paths = [
        resolveMatrixCredentialsPath(env, accountId),
        resolveLegacyMigrationSourcePath(env, accountId),
    ];
    for (const filePath of paths) {
        if (!filePath) {
            continue;
        }
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        catch {
            // ignore
        }
    }
}
export function credentialsMatchConfig(stored, config) {
    if (!config.userId) {
        if (!config.accessToken) {
            return false;
        }
        return stored.homeserver === config.homeserver && stored.accessToken === config.accessToken;
    }
    return stored.homeserver === config.homeserver && stored.userId === config.userId;
}
