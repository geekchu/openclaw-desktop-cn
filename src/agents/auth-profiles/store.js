import fs from "node:fs";
import { withFileLock } from "../../infra/file-lock.js";
import { saveJsonFile } from "../../infra/json-file.js";
import { AUTH_STORE_LOCK_OPTIONS, AUTH_STORE_VERSION, EXTERNAL_CLI_SYNC_TTL_MS, log, } from "./constants.js";
import { overlayExternalAuthProfiles, shouldPersistExternalAuthProfile } from "./external-auth.js";
import { syncExternalCliCredentials } from "./external-cli-sync.js";
import { ensureAuthStoreFile, resolveAuthStatePath, resolveAuthStorePath, resolveLegacyAuthStorePath, } from "./paths.js";
import { applyLegacyAuthStore, buildPersistedAuthProfileSecretsStore, loadLegacyAuthProfileStore, loadPersistedAuthProfileStore, mergeAuthProfileStores, mergeOAuthFileIntoStore, } from "./persisted.js";
import { savePersistedAuthProfileState } from "./state.js";
const runtimeAuthStoreSnapshots = new Map();
const loadedAuthStoreCache = new Map();
function resolveRuntimeStoreKey(agentDir) {
    return resolveAuthStorePath(agentDir);
}
function cloneAuthProfileStore(store) {
    return structuredClone(store);
}
function resolveRuntimeAuthProfileStore(agentDir) {
    if (runtimeAuthStoreSnapshots.size === 0) {
        return null;
    }
    const mainKey = resolveRuntimeStoreKey(undefined);
    const requestedKey = resolveRuntimeStoreKey(agentDir);
    const mainStore = runtimeAuthStoreSnapshots.get(mainKey);
    const requestedStore = runtimeAuthStoreSnapshots.get(requestedKey);
    if (!agentDir || requestedKey === mainKey) {
        if (!mainStore) {
            return null;
        }
        return cloneAuthProfileStore(mainStore);
    }
    if (mainStore && requestedStore) {
        return mergeAuthProfileStores(cloneAuthProfileStore(mainStore), cloneAuthProfileStore(requestedStore));
    }
    if (requestedStore) {
        return cloneAuthProfileStore(requestedStore);
    }
    if (mainStore) {
        return cloneAuthProfileStore(mainStore);
    }
    return null;
}
function hasStoredAuthProfileFiles(agentDir) {
    return (fs.existsSync(resolveAuthStorePath(agentDir)) ||
        fs.existsSync(resolveAuthStatePath(agentDir)) ||
        fs.existsSync(resolveLegacyAuthStorePath(agentDir)));
}
export function replaceRuntimeAuthProfileStoreSnapshots(entries) {
    runtimeAuthStoreSnapshots.clear();
    for (const entry of entries) {
        runtimeAuthStoreSnapshots.set(resolveRuntimeStoreKey(entry.agentDir), cloneAuthProfileStore(entry.store));
    }
}
export function clearRuntimeAuthProfileStoreSnapshots() {
    runtimeAuthStoreSnapshots.clear();
    loadedAuthStoreCache.clear();
}
function readAuthStoreMtimeMs(authPath) {
    try {
        return fs.statSync(authPath).mtimeMs;
    }
    catch {
        return null;
    }
}
function readCachedAuthProfileStore(params) {
    const cached = loadedAuthStoreCache.get(params.authPath);
    if (!cached ||
        cached.authMtimeMs !== params.authMtimeMs ||
        cached.stateMtimeMs !== params.stateMtimeMs) {
        return null;
    }
    if (Date.now() - cached.syncedAtMs >= EXTERNAL_CLI_SYNC_TTL_MS) {
        return null;
    }
    return cloneAuthProfileStore(cached.store);
}
function writeCachedAuthProfileStore(params) {
    loadedAuthStoreCache.set(params.authPath, {
        authMtimeMs: params.authMtimeMs,
        stateMtimeMs: params.stateMtimeMs,
        syncedAtMs: Date.now(),
        store: cloneAuthProfileStore(params.store),
    });
}
export async function updateAuthProfileStoreWithLock(params) {
    const authPath = resolveAuthStorePath(params.agentDir);
    ensureAuthStoreFile(authPath);
    try {
        return await withFileLock(authPath, AUTH_STORE_LOCK_OPTIONS, async () => {
            // Locked writers must reload from disk, not from any runtime snapshot.
            // Otherwise a live gateway can overwrite fresher CLI/config-auth writes
            // with stale in-memory auth state during usage/cooldown updates.
            const store = loadAuthProfileStoreForAgent(params.agentDir);
            const shouldSave = params.updater(store);
            if (shouldSave) {
                saveAuthProfileStore(store, params.agentDir);
            }
            return store;
        });
    }
    catch {
        return null;
    }
}
function shouldLogAuthStoreTiming() {
    return process.env.OPENCLAW_DEBUG_INGRESS_TIMING === "1";
}
function syncExternalCliCredentialsTimed(store, options) {
    if (!shouldLogAuthStoreTiming()) {
        return syncExternalCliCredentials(store, options);
    }
    const startMs = Date.now();
    const mutated = syncExternalCliCredentials(store, options);
    log.info(`auth-store stage=external-cli-sync elapsedMs=${Date.now() - startMs} mutated=${mutated}`);
    return mutated;
}
function shouldSyncExternalCliCredentials(options) {
    return options?.syncExternalCli !== false;
}
export function loadAuthProfileStore() {
    const asStore = loadPersistedAuthProfileStore();
    if (asStore) {
        // Sync from external CLI tools on every load.
        syncExternalCliCredentialsTimed(asStore);
        return overlayExternalAuthProfiles(asStore);
    }
    const legacy = loadLegacyAuthProfileStore();
    if (legacy) {
        const store = {
            version: AUTH_STORE_VERSION,
            profiles: {},
        };
        applyLegacyAuthStore(store, legacy);
        syncExternalCliCredentialsTimed(store);
        return overlayExternalAuthProfiles(store);
    }
    const store = { version: AUTH_STORE_VERSION, profiles: {} };
    syncExternalCliCredentialsTimed(store);
    return overlayExternalAuthProfiles(store);
}
function loadAuthProfileStoreForAgent(agentDir, options) {
    const readOnly = options?.readOnly === true;
    const authPath = resolveAuthStorePath(agentDir);
    const statePath = resolveAuthStatePath(agentDir);
    const authMtimeMs = readAuthStoreMtimeMs(authPath);
    const stateMtimeMs = readAuthStoreMtimeMs(statePath);
    if (!readOnly) {
        const cached = readCachedAuthProfileStore({
            authPath,
            authMtimeMs,
            stateMtimeMs,
        });
        if (cached) {
            return cached;
        }
    }
    const asStore = loadPersistedAuthProfileStore(agentDir);
    if (asStore) {
        // Runtime secret activation must remain read-only:
        // sync external CLI credentials in-memory, but never persist while readOnly.
        if (shouldSyncExternalCliCredentials(options)) {
            syncExternalCliCredentialsTimed(asStore, { log: !readOnly });
        }
        if (!readOnly) {
            writeCachedAuthProfileStore({
                authPath,
                authMtimeMs: readAuthStoreMtimeMs(authPath),
                stateMtimeMs: readAuthStoreMtimeMs(statePath),
                store: asStore,
            });
        }
        return asStore;
    }
    // Fallback: inherit auth-profiles from main agent if subagent has none
    if (agentDir && !readOnly) {
        const mainStore = loadPersistedAuthProfileStore();
        if (mainStore && Object.keys(mainStore.profiles).length > 0) {
            // Clone only secret-bearing profiles to subagent directory for auth inheritance.
            saveJsonFile(authPath, buildPersistedAuthProfileSecretsStore(mainStore));
            log.info("inherited auth-profiles from main agent", { agentDir });
            const inherited = { version: mainStore.version, profiles: { ...mainStore.profiles } };
            writeCachedAuthProfileStore({
                authPath,
                authMtimeMs: readAuthStoreMtimeMs(authPath),
                stateMtimeMs: readAuthStoreMtimeMs(statePath),
                store: inherited,
            });
            return inherited;
        }
    }
    const legacy = loadLegacyAuthProfileStore(agentDir);
    const store = {
        version: AUTH_STORE_VERSION,
        profiles: {},
    };
    if (legacy) {
        applyLegacyAuthStore(store, legacy);
    }
    const mergedOAuth = mergeOAuthFileIntoStore(store);
    // Keep external CLI credentials visible in runtime even during read-only loads.
    if (shouldSyncExternalCliCredentials(options)) {
        syncExternalCliCredentialsTimed(store, { log: !readOnly });
    }
    const forceReadOnly = process.env.OPENCLAW_AUTH_STORE_READONLY === "1";
    const shouldWrite = !readOnly && !forceReadOnly && (legacy !== null || mergedOAuth);
    if (shouldWrite) {
        saveAuthProfileStore(store, agentDir);
    }
    // PR #368: legacy auth.json could get re-migrated from other agent dirs,
    // overwriting fresh OAuth creds with stale tokens (fixes #363). Delete only
    // after we've successfully written auth-profiles.json.
    if (shouldWrite && legacy !== null) {
        const legacyPath = resolveLegacyAuthStorePath(agentDir);
        try {
            fs.unlinkSync(legacyPath);
        }
        catch (err) {
            if (err?.code !== "ENOENT") {
                log.warn("failed to delete legacy auth.json after migration", {
                    err,
                    legacyPath,
                });
            }
        }
    }
    if (!readOnly) {
        writeCachedAuthProfileStore({
            authPath,
            authMtimeMs: readAuthStoreMtimeMs(authPath),
            stateMtimeMs: readAuthStoreMtimeMs(statePath),
            store,
        });
    }
    return store;
}
export function loadAuthProfileStoreForRuntime(agentDir, options) {
    const store = loadAuthProfileStoreForAgent(agentDir, options);
    const authPath = resolveAuthStorePath(agentDir);
    const mainAuthPath = resolveAuthStorePath();
    if (!agentDir || authPath === mainAuthPath) {
        return overlayExternalAuthProfiles(store, { agentDir });
    }
    const mainStore = loadAuthProfileStoreForAgent(undefined, options);
    return overlayExternalAuthProfiles(mergeAuthProfileStores(mainStore, store), {
        agentDir,
    });
}
export function loadAuthProfileStoreForSecretsRuntime(agentDir) {
    return loadAuthProfileStoreForRuntime(agentDir, { readOnly: true, allowKeychainPrompt: false });
}
export function ensureAuthProfileStore(agentDir, options) {
    const runtimeStore = resolveRuntimeAuthProfileStore(agentDir);
    if (runtimeStore) {
        return overlayExternalAuthProfiles(runtimeStore, { agentDir });
    }
    const store = loadAuthProfileStoreForAgent(agentDir, options);
    const authPath = resolveAuthStorePath(agentDir);
    const mainAuthPath = resolveAuthStorePath();
    if (!agentDir || authPath === mainAuthPath) {
        return overlayExternalAuthProfiles(store, { agentDir });
    }
    const mainStore = loadAuthProfileStoreForAgent(undefined, options);
    const merged = mergeAuthProfileStores(mainStore, store);
    return overlayExternalAuthProfiles(merged, { agentDir });
}
export function ensureAuthProfileStoreForLocalUpdate(agentDir) {
    const options = { syncExternalCli: false };
    const store = loadAuthProfileStoreForAgent(agentDir, options);
    const authPath = resolveAuthStorePath(agentDir);
    const mainAuthPath = resolveAuthStorePath();
    if (!agentDir || authPath === mainAuthPath) {
        return store;
    }
    const mainStore = loadAuthProfileStoreForAgent(undefined, {
        readOnly: true,
        syncExternalCli: false,
    });
    return mergeAuthProfileStores(mainStore, store);
}
export function hasAnyAuthProfileStoreSource(agentDir) {
    const runtimeStore = resolveRuntimeAuthProfileStore(agentDir);
    if (runtimeStore && Object.keys(runtimeStore.profiles).length > 0) {
        return true;
    }
    if (hasStoredAuthProfileFiles(agentDir)) {
        return true;
    }
    const authPath = resolveAuthStorePath(agentDir);
    const mainAuthPath = resolveAuthStorePath();
    if (agentDir && authPath !== mainAuthPath && hasStoredAuthProfileFiles(undefined)) {
        return true;
    }
    return false;
}
export function saveAuthProfileStore(store, agentDir, options) {
    const authPath = resolveAuthStorePath(agentDir);
    const statePath = resolveAuthStatePath(agentDir);
    const runtimeKey = resolveRuntimeStoreKey(agentDir);
    const payload = buildPersistedAuthProfileSecretsStore(store, ({ profileId, credential }) => {
        if (credential.type !== "oauth") {
            return true;
        }
        if (options?.filterExternalAuthProfiles === false) {
            return true;
        }
        return shouldPersistExternalAuthProfile({
            store,
            profileId,
            credential,
            agentDir,
        });
    });
    saveJsonFile(authPath, payload);
    savePersistedAuthProfileState(store, agentDir);
    const runtimeStore = cloneAuthProfileStore(store);
    if (shouldSyncExternalCliCredentials(options)) {
        syncExternalCliCredentialsTimed(runtimeStore, { log: false });
    }
    writeCachedAuthProfileStore({
        authPath,
        authMtimeMs: readAuthStoreMtimeMs(authPath),
        stateMtimeMs: readAuthStoreMtimeMs(statePath),
        store: runtimeStore,
    });
    if (runtimeAuthStoreSnapshots.has(runtimeKey)) {
        runtimeAuthStoreSnapshots.set(runtimeKey, cloneAuthProfileStore(runtimeStore));
    }
}
