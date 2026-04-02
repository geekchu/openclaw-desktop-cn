let matrixCryptoNodeRuntimePromise = null;
async function loadMatrixCryptoNodeRuntime() {
    // Keep the native crypto package out of the main CLI startup graph.
    matrixCryptoNodeRuntimePromise ??= import("./crypto-node.runtime.js");
    return await matrixCryptoNodeRuntimePromise;
}
export function createMatrixCryptoFacade(deps) {
    return {
        prepare: async (_joinedRooms) => {
            // matrix-js-sdk performs crypto prep during startup; no extra work required here.
        },
        updateSyncData: async (_toDeviceMessages, _otkCounts, _unusedFallbackKeyAlgs, _changedDeviceLists, _leftDeviceLists) => {
            // compatibility no-op
        },
        isRoomEncrypted: async (roomId) => {
            const room = deps.client.getRoom(roomId);
            if (room?.hasEncryptionStateEvent()) {
                return true;
            }
            try {
                const event = await deps.getRoomStateEvent(roomId, "m.room.encryption", "");
                return typeof event.algorithm === "string" && event.algorithm.length > 0;
            }
            catch {
                return false;
            }
        },
        requestOwnUserVerification: async () => {
            const crypto = deps.client.getCrypto();
            return await deps.verificationManager.requestOwnUserVerification(crypto);
        },
        encryptMedia: async (buffer) => {
            const { Attachment } = await loadMatrixCryptoNodeRuntime();
            const encrypted = Attachment.encrypt(new Uint8Array(buffer));
            const mediaInfoJson = encrypted.mediaEncryptionInfo;
            if (!mediaInfoJson) {
                throw new Error("Matrix media encryption failed: missing media encryption info");
            }
            const parsed = JSON.parse(mediaInfoJson);
            return {
                buffer: Buffer.from(encrypted.encryptedData),
                file: {
                    key: parsed.key,
                    iv: parsed.iv,
                    hashes: parsed.hashes,
                    v: parsed.v,
                },
            };
        },
        decryptMedia: async (file, opts) => {
            const { Attachment, EncryptedAttachment } = await loadMatrixCryptoNodeRuntime();
            const encrypted = await deps.downloadContent(file.url, opts);
            const metadata = {
                url: file.url,
                key: file.key,
                iv: file.iv,
                hashes: file.hashes,
                v: file.v,
            };
            const attachment = new EncryptedAttachment(new Uint8Array(encrypted), JSON.stringify(metadata));
            const decrypted = Attachment.decrypt(attachment);
            return Buffer.from(decrypted);
        },
        getRecoveryKey: async () => {
            return deps.recoveryKeyStore.getRecoveryKeySummary();
        },
        listVerifications: async () => {
            return deps.verificationManager.listVerifications();
        },
        ensureVerificationDmTracked: async ({ roomId, userId }) => {
            const crypto = deps.client.getCrypto();
            const request = typeof crypto?.findVerificationRequestDMInProgress === "function"
                ? crypto.findVerificationRequestDMInProgress(roomId, userId)
                : undefined;
            if (!request) {
                return null;
            }
            return deps.verificationManager.trackVerificationRequest(request);
        },
        requestVerification: async (params) => {
            const crypto = deps.client.getCrypto();
            return await deps.verificationManager.requestVerification(crypto, params);
        },
        acceptVerification: async (id) => {
            return await deps.verificationManager.acceptVerification(id);
        },
        cancelVerification: async (id, params) => {
            return await deps.verificationManager.cancelVerification(id, params);
        },
        startVerification: async (id, method = "sas") => {
            return await deps.verificationManager.startVerification(id, method);
        },
        generateVerificationQr: async (id) => {
            return await deps.verificationManager.generateVerificationQr(id);
        },
        scanVerificationQr: async (id, qrDataBase64) => {
            return await deps.verificationManager.scanVerificationQr(id, qrDataBase64);
        },
        confirmVerificationSas: async (id) => {
            return await deps.verificationManager.confirmVerificationSas(id);
        },
        mismatchVerificationSas: async (id) => {
            return deps.verificationManager.mismatchVerificationSas(id);
        },
        confirmVerificationReciprocateQr: async (id) => {
            return deps.verificationManager.confirmVerificationReciprocateQr(id);
        },
        getVerificationSas: async (id) => {
            return deps.verificationManager.getVerificationSas(id);
        },
    };
}
