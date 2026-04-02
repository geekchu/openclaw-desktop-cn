import { normalizeOptionalAccountId } from "openclaw/plugin-sdk/account-id";
import { LogService } from "../sdk/logger.js";
import { resolveMatrixAuth, resolveMatrixAuthContext } from "./config.js";
import { createMatrixClient } from "./create-client.js";
const sharedClientStates = new Map();
const sharedClientPromises = new Map();
function buildSharedClientKey(auth) {
    return [
        auth.homeserver,
        auth.userId,
        auth.accessToken,
        auth.encryption ? "e2ee" : "plain",
        auth.allowPrivateNetwork ? "private-net" : "strict-net",
        auth.accountId,
    ].join("|");
}
async function createSharedMatrixClient(params) {
    const client = await createMatrixClient({
        homeserver: params.auth.homeserver,
        userId: params.auth.userId,
        accessToken: params.auth.accessToken,
        password: params.auth.password,
        deviceId: params.auth.deviceId,
        encryption: params.auth.encryption,
        localTimeoutMs: params.timeoutMs,
        initialSyncLimit: params.auth.initialSyncLimit,
        accountId: params.auth.accountId,
        allowPrivateNetwork: params.auth.allowPrivateNetwork,
        ssrfPolicy: params.auth.ssrfPolicy,
    });
    return {
        client,
        key: buildSharedClientKey(params.auth),
        started: false,
        cryptoReady: false,
        startPromise: null,
        leases: 0,
    };
}
function findSharedClientStateByInstance(client) {
    for (const state of sharedClientStates.values()) {
        if (state.client === client) {
            return state;
        }
    }
    return null;
}
function deleteSharedClientState(state) {
    sharedClientStates.delete(state.key);
    sharedClientPromises.delete(state.key);
}
async function ensureSharedClientStarted(params) {
    if (params.state.started) {
        return;
    }
    if (params.state.startPromise) {
        await params.state.startPromise;
        return;
    }
    params.state.startPromise = (async () => {
        const client = params.state.client;
        // Initialize crypto if enabled
        if (params.encryption && !params.state.cryptoReady) {
            try {
                const joinedRooms = await client.getJoinedRooms();
                if (client.crypto) {
                    await client.crypto.prepare(joinedRooms);
                    params.state.cryptoReady = true;
                }
            }
            catch (err) {
                LogService.warn("MatrixClientLite", "Failed to prepare crypto:", err);
            }
        }
        await client.start();
        params.state.started = true;
    })();
    try {
        await params.state.startPromise;
    }
    finally {
        params.state.startPromise = null;
    }
}
async function resolveSharedMatrixClientState(params = {}) {
    const requestedAccountId = normalizeOptionalAccountId(params.accountId);
    if (params.auth && requestedAccountId && requestedAccountId !== params.auth.accountId) {
        throw new Error(`Matrix shared client account mismatch: requested ${requestedAccountId}, auth resolved ${params.auth.accountId}`);
    }
    const authContext = params.auth
        ? null
        : resolveMatrixAuthContext({
            cfg: params.cfg,
            env: params.env,
            accountId: params.accountId,
        });
    const auth = params.auth ??
        (await resolveMatrixAuth({
            cfg: authContext?.cfg ?? params.cfg,
            env: authContext?.env ?? params.env,
            accountId: authContext?.accountId,
        }));
    const key = buildSharedClientKey(auth);
    const shouldStart = params.startClient !== false;
    const existingState = sharedClientStates.get(key);
    if (existingState) {
        if (shouldStart) {
            await ensureSharedClientStarted({
                state: existingState,
                timeoutMs: params.timeoutMs,
                initialSyncLimit: auth.initialSyncLimit,
                encryption: auth.encryption,
            });
        }
        return existingState;
    }
    const existingPromise = sharedClientPromises.get(key);
    if (existingPromise) {
        const pending = await existingPromise;
        if (shouldStart) {
            await ensureSharedClientStarted({
                state: pending,
                timeoutMs: params.timeoutMs,
                initialSyncLimit: auth.initialSyncLimit,
                encryption: auth.encryption,
            });
        }
        return pending;
    }
    const creationPromise = createSharedMatrixClient({
        auth,
        timeoutMs: params.timeoutMs,
    });
    sharedClientPromises.set(key, creationPromise);
    try {
        const created = await creationPromise;
        sharedClientStates.set(key, created);
        if (shouldStart) {
            await ensureSharedClientStarted({
                state: created,
                timeoutMs: params.timeoutMs,
                initialSyncLimit: auth.initialSyncLimit,
                encryption: auth.encryption,
            });
        }
        return created;
    }
    finally {
        sharedClientPromises.delete(key);
    }
}
export async function resolveSharedMatrixClient(params = {}) {
    const state = await resolveSharedMatrixClientState(params);
    return state.client;
}
export async function acquireSharedMatrixClient(params = {}) {
    const state = await resolveSharedMatrixClientState(params);
    state.leases += 1;
    return state.client;
}
export function stopSharedClient() {
    for (const state of sharedClientStates.values()) {
        state.client.stop();
    }
    sharedClientStates.clear();
    sharedClientPromises.clear();
}
export function stopSharedClientForAccount(auth) {
    const key = buildSharedClientKey(auth);
    const state = sharedClientStates.get(key);
    if (!state) {
        return;
    }
    state.client.stop();
    deleteSharedClientState(state);
}
export function removeSharedClientInstance(client) {
    const state = findSharedClientStateByInstance(client);
    if (!state) {
        return false;
    }
    deleteSharedClientState(state);
    return true;
}
export function stopSharedClientInstance(client) {
    if (!removeSharedClientInstance(client)) {
        return;
    }
    client.stop();
}
export async function releaseSharedClientInstance(client, mode = "stop") {
    const state = findSharedClientStateByInstance(client);
    if (!state) {
        return false;
    }
    state.leases = Math.max(0, state.leases - 1);
    if (state.leases > 0) {
        return false;
    }
    deleteSharedClientState(state);
    if (mode === "persist") {
        await client.stopAndPersist();
    }
    else {
        client.stop();
    }
    return true;
}
