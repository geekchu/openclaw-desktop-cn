import { getMatrixRuntime } from "../../runtime.js";
import { formatMatrixEncryptionUnavailableError } from "../encryption-guidance.js";
import { withStartedActionClient } from "./client.js";
function requireCrypto(client, opts) {
    if (!client.crypto) {
        const cfg = opts.cfg ?? getMatrixRuntime().config.loadConfig();
        throw new Error(formatMatrixEncryptionUnavailableError(cfg, opts.accountId));
    }
    return client.crypto;
}
function resolveVerificationId(input) {
    const normalized = input.trim();
    if (!normalized) {
        throw new Error("Matrix verification request id is required");
    }
    return normalized;
}
export async function listMatrixVerifications(opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.listVerifications();
    });
}
export async function requestMatrixVerification(params = {}) {
    return await withStartedActionClient(params, async (client) => {
        const crypto = requireCrypto(client, params);
        const ownUser = params.ownUser ?? (!params.userId && !params.deviceId && !params.roomId);
        return await crypto.requestVerification({
            ownUser,
            userId: params.userId?.trim() || undefined,
            deviceId: params.deviceId?.trim() || undefined,
            roomId: params.roomId?.trim() || undefined,
        });
    });
}
export async function acceptMatrixVerification(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.acceptVerification(resolveVerificationId(requestId));
    });
}
export async function cancelMatrixVerification(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.cancelVerification(resolveVerificationId(requestId), {
            reason: opts.reason?.trim() || undefined,
            code: opts.code?.trim() || undefined,
        });
    });
}
export async function startMatrixVerification(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.startVerification(resolveVerificationId(requestId), opts.method ?? "sas");
    });
}
export async function generateMatrixVerificationQr(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.generateVerificationQr(resolveVerificationId(requestId));
    });
}
export async function scanMatrixVerificationQr(requestId, qrDataBase64, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        const payload = qrDataBase64.trim();
        if (!payload) {
            throw new Error("Matrix QR data is required");
        }
        return await crypto.scanVerificationQr(resolveVerificationId(requestId), payload);
    });
}
export async function getMatrixVerificationSas(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.getVerificationSas(resolveVerificationId(requestId));
    });
}
export async function confirmMatrixVerificationSas(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.confirmVerificationSas(resolveVerificationId(requestId));
    });
}
export async function mismatchMatrixVerificationSas(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.mismatchVerificationSas(resolveVerificationId(requestId));
    });
}
export async function confirmMatrixVerificationReciprocateQr(requestId, opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        return await crypto.confirmVerificationReciprocateQr(resolveVerificationId(requestId));
    });
}
export async function getMatrixEncryptionStatus(opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const crypto = requireCrypto(client, opts);
        const recoveryKey = await crypto.getRecoveryKey();
        return {
            encryptionEnabled: true,
            recoveryKeyStored: Boolean(recoveryKey),
            recoveryKeyCreatedAt: recoveryKey?.createdAt ?? null,
            ...(opts.includeRecoveryKey ? { recoveryKey: recoveryKey?.encodedPrivateKey ?? null } : {}),
            pendingVerifications: (await crypto.listVerifications()).length,
        };
    });
}
export async function getMatrixVerificationStatus(opts = {}) {
    return await withStartedActionClient(opts, async (client) => {
        const status = await client.getOwnDeviceVerificationStatus();
        const payload = {
            ...status,
            pendingVerifications: client.crypto ? (await client.crypto.listVerifications()).length : 0,
        };
        if (!opts.includeRecoveryKey) {
            return payload;
        }
        const recoveryKey = client.crypto ? await client.crypto.getRecoveryKey() : null;
        return {
            ...payload,
            recoveryKey: recoveryKey?.encodedPrivateKey ?? null,
        };
    });
}
export async function getMatrixRoomKeyBackupStatus(opts = {}) {
    return await withStartedActionClient(opts, async (client) => await client.getRoomKeyBackupStatus());
}
export async function verifyMatrixRecoveryKey(recoveryKey, opts = {}) {
    return await withStartedActionClient(opts, async (client) => await client.verifyWithRecoveryKey(recoveryKey));
}
export async function restoreMatrixRoomKeyBackup(opts = {}) {
    return await withStartedActionClient(opts, async (client) => await client.restoreRoomKeyBackup({
        recoveryKey: opts.recoveryKey?.trim() || undefined,
    }));
}
export async function resetMatrixRoomKeyBackup(opts = {}) {
    return await withStartedActionClient(opts, async (client) => await client.resetRoomKeyBackup());
}
export async function bootstrapMatrixVerification(opts = {}) {
    return await withStartedActionClient(opts, async (client) => await client.bootstrapOwnDeviceVerification({
        recoveryKey: opts.recoveryKey?.trim() || undefined,
        forceResetCrossSigning: opts.forceResetCrossSigning === true,
    }));
}
