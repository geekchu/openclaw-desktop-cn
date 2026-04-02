import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { MatrixEventEvent } from "matrix-js-sdk/lib/matrix.js";
import { LogService, noop } from "./logger.js";
const MATRIX_DECRYPT_RETRY_BASE_DELAY_MS = 1_500;
const MATRIX_DECRYPT_RETRY_MAX_DELAY_MS = 30_000;
const MATRIX_DECRYPT_RETRY_MAX_ATTEMPTS = 8;
function resolveDecryptRetryKey(roomId, eventId) {
    if (!roomId || !eventId) {
        return null;
    }
    return `${roomId}|${eventId}`;
}
function isDecryptionFailure(event) {
    return (typeof event.isDecryptionFailure === "function" &&
        event.isDecryptionFailure());
}
export class MatrixDecryptBridge {
    deps;
    trackedEncryptedEvents = new WeakSet();
    decryptedMessageDedupe = new Map();
    decryptRetries = new Map();
    failedDecryptionsNotified = new Set();
    activeRetryRuns = 0;
    retryIdleResolvers = new Set();
    cryptoRetrySignalsBound = false;
    constructor(deps) {
        this.deps = deps;
    }
    shouldEmitUnencryptedMessage(roomId, eventId) {
        if (!eventId) {
            return true;
        }
        const key = `${roomId}|${eventId}`;
        const createdAt = this.decryptedMessageDedupe.get(key);
        if (createdAt === undefined) {
            return true;
        }
        this.decryptedMessageDedupe.delete(key);
        return false;
    }
    attachEncryptedEvent(event, roomId) {
        if (this.trackedEncryptedEvents.has(event)) {
            return;
        }
        this.trackedEncryptedEvents.add(event);
        event.on(MatrixEventEvent.Decrypted, (decryptedEvent, err) => {
            this.handleEncryptedEventDecrypted({
                roomId,
                encryptedEvent: event,
                decryptedEvent,
                err,
            });
        });
    }
    retryPendingNow(reason) {
        const pending = Array.from(this.decryptRetries.entries());
        if (pending.length === 0) {
            return;
        }
        LogService.debug("MatrixClientLite", `Retrying pending decryptions due to ${reason}`);
        for (const [retryKey, state] of pending) {
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
            if (state.inFlight) {
                continue;
            }
            this.runDecryptRetry(retryKey).catch(noop);
        }
    }
    bindCryptoRetrySignals(crypto) {
        if (!crypto || this.cryptoRetrySignalsBound) {
            return;
        }
        this.cryptoRetrySignalsBound = true;
        const trigger = (reason) => {
            this.retryPendingNow(reason);
        };
        crypto.on(CryptoEvent.KeyBackupDecryptionKeyCached, () => {
            trigger("crypto.keyBackupDecryptionKeyCached");
        });
        crypto.on(CryptoEvent.RehydrationCompleted, () => {
            trigger("dehydration.RehydrationCompleted");
        });
        crypto.on(CryptoEvent.DevicesUpdated, () => {
            trigger("crypto.devicesUpdated");
        });
        crypto.on(CryptoEvent.KeysChanged, () => {
            trigger("crossSigning.keysChanged");
        });
    }
    stop() {
        for (const retryKey of this.decryptRetries.keys()) {
            this.clearDecryptRetry(retryKey);
        }
    }
    async drainPendingDecryptions(reason) {
        for (let attempts = 0; attempts < MATRIX_DECRYPT_RETRY_MAX_ATTEMPTS; attempts += 1) {
            if (this.decryptRetries.size === 0) {
                return;
            }
            this.retryPendingNow(reason);
            await this.waitForActiveRetryRunsToFinish();
            const hasPendingRetryTimers = Array.from(this.decryptRetries.values()).some((state) => state.timer || state.inFlight);
            if (!hasPendingRetryTimers) {
                return;
            }
        }
    }
    handleEncryptedEventDecrypted(params) {
        const decryptedRoomId = params.decryptedEvent.getRoomId() || params.roomId;
        const decryptedRaw = this.deps.toRaw(params.decryptedEvent);
        const retryEventId = decryptedRaw.event_id || params.encryptedEvent.getId() || "";
        const retryKey = resolveDecryptRetryKey(decryptedRoomId, retryEventId);
        if (params.err) {
            this.emitFailedDecryptionOnce(retryKey, decryptedRoomId, decryptedRaw, params.err);
            this.scheduleDecryptRetry({
                event: params.encryptedEvent,
                roomId: decryptedRoomId,
                eventId: retryEventId,
            });
            return;
        }
        if (isDecryptionFailure(params.decryptedEvent)) {
            this.emitFailedDecryptionOnce(retryKey, decryptedRoomId, decryptedRaw, new Error("Matrix event failed to decrypt"));
            this.scheduleDecryptRetry({
                event: params.encryptedEvent,
                roomId: decryptedRoomId,
                eventId: retryEventId,
            });
            return;
        }
        if (retryKey) {
            this.clearDecryptRetry(retryKey);
        }
        this.rememberDecryptedMessage(decryptedRoomId, decryptedRaw.event_id);
        this.deps.emitDecryptedEvent(decryptedRoomId, decryptedRaw);
        this.deps.emitMessage(decryptedRoomId, decryptedRaw);
    }
    emitFailedDecryptionOnce(retryKey, roomId, event, error) {
        if (retryKey) {
            if (this.failedDecryptionsNotified.has(retryKey)) {
                return;
            }
            this.failedDecryptionsNotified.add(retryKey);
        }
        this.deps.emitFailedDecryption(roomId, event, error);
    }
    scheduleDecryptRetry(params) {
        const retryKey = resolveDecryptRetryKey(params.roomId, params.eventId);
        if (!retryKey) {
            return;
        }
        const existing = this.decryptRetries.get(retryKey);
        if (existing?.timer || existing?.inFlight) {
            return;
        }
        const attempts = (existing?.attempts ?? 0) + 1;
        if (attempts > MATRIX_DECRYPT_RETRY_MAX_ATTEMPTS) {
            this.clearDecryptRetry(retryKey);
            LogService.debug("MatrixClientLite", `Giving up decryption retry for ${params.eventId} in ${params.roomId} after ${attempts - 1} attempts`);
            return;
        }
        const delayMs = Math.min(MATRIX_DECRYPT_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1), MATRIX_DECRYPT_RETRY_MAX_DELAY_MS);
        const next = {
            event: params.event,
            roomId: params.roomId,
            eventId: params.eventId,
            attempts,
            inFlight: false,
            timer: null,
        };
        next.timer = setTimeout(() => {
            this.runDecryptRetry(retryKey).catch(noop);
        }, delayMs);
        this.decryptRetries.set(retryKey, next);
    }
    async runDecryptRetry(retryKey) {
        const state = this.decryptRetries.get(retryKey);
        if (!state || state.inFlight) {
            return;
        }
        state.inFlight = true;
        state.timer = null;
        this.activeRetryRuns += 1;
        const canDecrypt = typeof this.deps.client.decryptEventIfNeeded === "function";
        if (!canDecrypt) {
            this.clearDecryptRetry(retryKey);
            this.activeRetryRuns = Math.max(0, this.activeRetryRuns - 1);
            this.resolveRetryIdleIfNeeded();
            return;
        }
        try {
            await this.deps.client.decryptEventIfNeeded?.(state.event, {
                isRetry: true,
            });
        }
        catch {
            // Retry with backoff until we hit the configured retry cap.
        }
        finally {
            state.inFlight = false;
            this.activeRetryRuns = Math.max(0, this.activeRetryRuns - 1);
            this.resolveRetryIdleIfNeeded();
        }
        if (this.decryptRetries.get(retryKey) !== state) {
            return;
        }
        if (isDecryptionFailure(state.event)) {
            this.scheduleDecryptRetry(state);
            return;
        }
        this.clearDecryptRetry(retryKey);
    }
    clearDecryptRetry(retryKey) {
        const state = this.decryptRetries.get(retryKey);
        if (state?.timer) {
            clearTimeout(state.timer);
        }
        this.decryptRetries.delete(retryKey);
        this.failedDecryptionsNotified.delete(retryKey);
    }
    rememberDecryptedMessage(roomId, eventId) {
        if (!eventId) {
            return;
        }
        const now = Date.now();
        this.pruneDecryptedMessageDedupe(now);
        this.decryptedMessageDedupe.set(`${roomId}|${eventId}`, now);
    }
    pruneDecryptedMessageDedupe(now) {
        const ttlMs = 30_000;
        for (const [key, createdAt] of this.decryptedMessageDedupe) {
            if (now - createdAt > ttlMs) {
                this.decryptedMessageDedupe.delete(key);
            }
        }
        const maxEntries = 2048;
        while (this.decryptedMessageDedupe.size > maxEntries) {
            const oldest = this.decryptedMessageDedupe.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.decryptedMessageDedupe.delete(oldest);
        }
    }
    async waitForActiveRetryRunsToFinish() {
        if (this.activeRetryRuns === 0) {
            return;
        }
        await new Promise((resolve) => {
            this.retryIdleResolvers.add(resolve);
            if (this.activeRetryRuns === 0) {
                this.retryIdleResolvers.delete(resolve);
                resolve();
            }
        });
    }
    resolveRetryIdleIfNeeded() {
        if (this.activeRetryRuns !== 0) {
            return;
        }
        for (const resolve of this.retryIdleResolvers) {
            resolve();
        }
        this.retryIdleResolvers.clear();
    }
}
