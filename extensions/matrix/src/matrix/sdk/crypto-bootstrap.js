import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import { LogService } from "./logger.js";
import { isRepairableSecretStorageAccessError } from "./recovery-key-store.js";
import { isMatrixDeviceOwnerVerified } from "./verification-status.js";
export class MatrixCryptoBootstrapper {
    deps;
    verificationHandlerRegistered = false;
    constructor(deps) {
        this.deps = deps;
    }
    async bootstrap(crypto, options = {}) {
        const strict = options.strict === true;
        // Register verification listeners before expensive bootstrap work so incoming requests
        // are not missed during startup.
        this.registerVerificationRequestHandler(crypto);
        await this.bootstrapSecretStorage(crypto, {
            strict,
            allowSecretStorageRecreateWithoutRecoveryKey: options.allowSecretStorageRecreateWithoutRecoveryKey === true,
        });
        const crossSigning = await this.bootstrapCrossSigning(crypto, {
            forceResetCrossSigning: options.forceResetCrossSigning === true,
            allowAutomaticCrossSigningReset: options.allowAutomaticCrossSigningReset !== false,
            allowSecretStorageRecreateWithoutRecoveryKey: options.allowSecretStorageRecreateWithoutRecoveryKey === true,
            strict,
        });
        await this.bootstrapSecretStorage(crypto, {
            strict,
            allowSecretStorageRecreateWithoutRecoveryKey: options.allowSecretStorageRecreateWithoutRecoveryKey === true,
        });
        const ownDeviceVerified = await this.ensureOwnDeviceTrust(crypto, strict);
        return {
            crossSigningReady: crossSigning.ready,
            crossSigningPublished: crossSigning.published,
            ownDeviceVerified,
        };
    }
    createSigningKeysUiAuthCallback(params) {
        return async (makeRequest) => {
            try {
                return await makeRequest(null);
            }
            catch {
                // Some homeservers require an explicit dummy UIA stage even when no user interaction is needed.
                try {
                    return await makeRequest({ type: "m.login.dummy" });
                }
                catch {
                    if (!params.password?.trim()) {
                        throw new Error("Matrix cross-signing key upload requires UIA; provide matrix.password for m.login.password fallback");
                    }
                    return await makeRequest({
                        type: "m.login.password",
                        identifier: { type: "m.id.user", user: params.userId },
                        password: params.password,
                    });
                }
            }
        };
    }
    async bootstrapCrossSigning(crypto, options) {
        const userId = await this.deps.getUserId();
        const authUploadDeviceSigningKeys = this.createSigningKeysUiAuthCallback({
            userId,
            password: this.deps.getPassword?.(),
        });
        const hasPublishedCrossSigningKeys = async () => {
            if (typeof crypto.userHasCrossSigningKeys !== "function") {
                return true;
            }
            try {
                return await crypto.userHasCrossSigningKeys(userId, true);
            }
            catch {
                return false;
            }
        };
        const isCrossSigningReady = async () => {
            if (typeof crypto.isCrossSigningReady !== "function") {
                return true;
            }
            try {
                return await crypto.isCrossSigningReady();
            }
            catch {
                return false;
            }
        };
        const finalize = async () => {
            const ready = await isCrossSigningReady();
            const published = await hasPublishedCrossSigningKeys();
            if (ready && published) {
                LogService.info("MatrixClientLite", "Cross-signing bootstrap complete");
                return { ready, published };
            }
            const message = "Cross-signing bootstrap finished but server keys are still not published";
            LogService.warn("MatrixClientLite", message);
            if (options.strict) {
                throw new Error(message);
            }
            return { ready, published };
        };
        if (options.forceResetCrossSigning) {
            try {
                await crypto.bootstrapCrossSigning({
                    setupNewCrossSigning: true,
                    authUploadDeviceSigningKeys,
                });
            }
            catch (err) {
                LogService.warn("MatrixClientLite", "Forced cross-signing reset failed:", err);
                if (options.strict) {
                    throw err instanceof Error ? err : new Error(String(err));
                }
                return { ready: false, published: false };
            }
            return await finalize();
        }
        // First pass: preserve existing cross-signing identity and ensure public keys are uploaded.
        try {
            await crypto.bootstrapCrossSigning({
                authUploadDeviceSigningKeys,
            });
        }
        catch (err) {
            const shouldRepairSecretStorage = options.allowSecretStorageRecreateWithoutRecoveryKey &&
                isRepairableSecretStorageAccessError(err);
            if (shouldRepairSecretStorage) {
                LogService.warn("MatrixClientLite", "Cross-signing bootstrap could not unlock secret storage; recreating secret storage during explicit bootstrap and retrying.");
                await this.deps.recoveryKeyStore.bootstrapSecretStorageWithRecoveryKey(crypto, {
                    allowSecretStorageRecreateWithoutRecoveryKey: true,
                    forceNewSecretStorage: true,
                });
                await crypto.bootstrapCrossSigning({
                    authUploadDeviceSigningKeys,
                });
            }
            else if (!options.allowAutomaticCrossSigningReset) {
                LogService.warn("MatrixClientLite", "Initial cross-signing bootstrap failed and automatic reset is disabled:", err);
                return { ready: false, published: false };
            }
            else {
                LogService.warn("MatrixClientLite", "Initial cross-signing bootstrap failed, trying reset:", err);
                try {
                    await crypto.bootstrapCrossSigning({
                        setupNewCrossSigning: true,
                        authUploadDeviceSigningKeys,
                    });
                }
                catch (resetErr) {
                    LogService.warn("MatrixClientLite", "Failed to bootstrap cross-signing:", resetErr);
                    if (options.strict) {
                        throw resetErr instanceof Error ? resetErr : new Error(String(resetErr));
                    }
                    return { ready: false, published: false };
                }
            }
        }
        const firstPassReady = await isCrossSigningReady();
        const firstPassPublished = await hasPublishedCrossSigningKeys();
        if (firstPassReady && firstPassPublished) {
            LogService.info("MatrixClientLite", "Cross-signing bootstrap complete");
            return { ready: true, published: true };
        }
        if (!options.allowAutomaticCrossSigningReset) {
            return { ready: firstPassReady, published: firstPassPublished };
        }
        // Fallback: recover from broken local/server state by creating a fresh identity.
        try {
            await crypto.bootstrapCrossSigning({
                setupNewCrossSigning: true,
                authUploadDeviceSigningKeys,
            });
        }
        catch (err) {
            LogService.warn("MatrixClientLite", "Fallback cross-signing bootstrap failed:", err);
            if (options.strict) {
                throw err instanceof Error ? err : new Error(String(err));
            }
            return { ready: false, published: false };
        }
        return await finalize();
    }
    async bootstrapSecretStorage(crypto, options) {
        try {
            await this.deps.recoveryKeyStore.bootstrapSecretStorageWithRecoveryKey(crypto, {
                allowSecretStorageRecreateWithoutRecoveryKey: options.allowSecretStorageRecreateWithoutRecoveryKey,
            });
            LogService.info("MatrixClientLite", "Secret storage bootstrap complete");
        }
        catch (err) {
            LogService.warn("MatrixClientLite", "Failed to bootstrap secret storage:", err);
            if (options.strict) {
                throw err instanceof Error ? err : new Error(String(err));
            }
        }
    }
    registerVerificationRequestHandler(crypto) {
        if (this.verificationHandlerRegistered) {
            return;
        }
        this.verificationHandlerRegistered = true;
        // Track incoming requests; verification lifecycle decisions live in the
        // verification manager so acceptance/start/dedupe share one code path.
        // Remote-user verifications are only auto-accepted. The human-operated
        // client must explicitly choose "Verify by emoji" so we do not race a
        // second SAS start from the bot side and end up with mismatched keys.
        crypto.on(CryptoEvent.VerificationRequestReceived, async (request) => {
            const verificationRequest = request;
            try {
                this.deps.verificationManager.trackVerificationRequest(verificationRequest);
            }
            catch (err) {
                LogService.warn("MatrixClientLite", `Failed to track verification request from ${verificationRequest.otherUserId}:`, err);
            }
        });
        this.deps.decryptBridge.bindCryptoRetrySignals(crypto);
        LogService.info("MatrixClientLite", "Verification request handler registered");
    }
    async ensureOwnDeviceTrust(crypto, strict = false) {
        const deviceId = this.deps.getDeviceId()?.trim();
        if (!deviceId) {
            return null;
        }
        const userId = await this.deps.getUserId();
        const deviceStatus = typeof crypto.getDeviceVerificationStatus === "function"
            ? await crypto.getDeviceVerificationStatus(userId, deviceId).catch(() => null)
            : null;
        const alreadyVerified = isMatrixDeviceOwnerVerified(deviceStatus);
        if (alreadyVerified) {
            return true;
        }
        if (typeof crypto.setDeviceVerified === "function") {
            await crypto.setDeviceVerified(userId, deviceId, true);
        }
        if (typeof crypto.crossSignDevice === "function") {
            const crossSigningReady = typeof crypto.isCrossSigningReady === "function"
                ? await crypto.isCrossSigningReady()
                : true;
            if (crossSigningReady) {
                await crypto.crossSignDevice(deviceId);
            }
        }
        const refreshedStatus = typeof crypto.getDeviceVerificationStatus === "function"
            ? await crypto.getDeviceVerificationStatus(userId, deviceId).catch(() => null)
            : null;
        const verified = isMatrixDeviceOwnerVerified(refreshedStatus);
        if (!verified && strict) {
            throw new Error(`Matrix own device ${deviceId} is not verified by its owner after bootstrap`);
        }
        return verified;
    }
}
