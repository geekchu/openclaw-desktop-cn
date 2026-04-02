import { VerificationPhase, VerificationRequestEvent, VerifierEvent, } from "matrix-js-sdk/lib/crypto-api/verification.js";
import { VerificationMethod } from "matrix-js-sdk/lib/types.js";
const MAX_TRACKED_VERIFICATION_SESSIONS = 256;
const TERMINAL_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const SAS_AUTO_CONFIRM_DELAY_MS = 30_000;
export class MatrixVerificationManager {
    verificationSessions = new Map();
    verificationSessionCounter = 0;
    trackedVerificationRequests = new WeakSet();
    trackedVerificationVerifiers = new WeakSet();
    summaryListeners = new Set();
    readRequestValue(request, reader, fallback) {
        try {
            return reader();
        }
        catch {
            return fallback;
        }
    }
    pruneVerificationSessions(nowMs) {
        for (const [id, session] of this.verificationSessions) {
            const phase = this.readRequestValue(session.request, () => session.request.phase, -1);
            const isTerminal = phase === VerificationPhase.Done || phase === VerificationPhase.Cancelled;
            if (isTerminal && nowMs - session.updatedAtMs > TERMINAL_SESSION_RETENTION_MS) {
                this.verificationSessions.delete(id);
            }
        }
        if (this.verificationSessions.size <= MAX_TRACKED_VERIFICATION_SESSIONS) {
            return;
        }
        const sortedByAge = Array.from(this.verificationSessions.entries()).sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs);
        const overflow = this.verificationSessions.size - MAX_TRACKED_VERIFICATION_SESSIONS;
        for (let i = 0; i < overflow; i += 1) {
            const entry = sortedByAge[i];
            if (entry) {
                this.verificationSessions.delete(entry[0]);
            }
        }
    }
    getVerificationPhaseName(phase) {
        switch (phase) {
            case VerificationPhase.Unsent:
                return "unsent";
            case VerificationPhase.Requested:
                return "requested";
            case VerificationPhase.Ready:
                return "ready";
            case VerificationPhase.Started:
                return "started";
            case VerificationPhase.Cancelled:
                return "cancelled";
            case VerificationPhase.Done:
                return "done";
            default:
                return `unknown(${phase})`;
        }
    }
    emitVerificationSummary(session) {
        const summary = this.buildVerificationSummary(session);
        for (const listener of this.summaryListeners) {
            listener(summary);
        }
    }
    touchVerificationSession(session) {
        session.updatedAtMs = Date.now();
        this.emitVerificationSummary(session);
    }
    clearSasAutoConfirmTimer(session) {
        if (!session.sasAutoConfirmTimer) {
            return;
        }
        clearTimeout(session.sasAutoConfirmTimer);
        session.sasAutoConfirmTimer = undefined;
    }
    buildVerificationSummary(session) {
        const request = session.request;
        const phase = this.readRequestValue(request, () => request.phase, VerificationPhase.Requested);
        const accepting = this.readRequestValue(request, () => request.accepting, false);
        const declining = this.readRequestValue(request, () => request.declining, false);
        const pending = this.readRequestValue(request, () => request.pending, false);
        const methodsRaw = this.readRequestValue(request, () => request.methods, []);
        const methods = Array.isArray(methodsRaw)
            ? methodsRaw.filter((entry) => typeof entry === "string")
            : [];
        const sasCallbacks = session.sasCallbacks ?? session.activeVerifier?.getShowSasCallbacks();
        if (sasCallbacks) {
            session.sasCallbacks = sasCallbacks;
        }
        const canAccept = phase < VerificationPhase.Ready && !accepting && !declining;
        return {
            id: session.id,
            transactionId: this.readRequestValue(request, () => request.transactionId, undefined),
            roomId: this.readRequestValue(request, () => request.roomId, undefined),
            otherUserId: this.readRequestValue(request, () => request.otherUserId, "unknown"),
            otherDeviceId: this.readRequestValue(request, () => request.otherDeviceId, undefined),
            isSelfVerification: this.readRequestValue(request, () => request.isSelfVerification, false),
            initiatedByMe: this.readRequestValue(request, () => request.initiatedByMe, false),
            phase,
            phaseName: this.getVerificationPhaseName(phase),
            pending,
            methods,
            chosenMethod: this.readRequestValue(request, () => request.chosenMethod ?? null, null),
            canAccept,
            hasSas: Boolean(sasCallbacks),
            sas: sasCallbacks
                ? {
                    decimal: sasCallbacks.sas.decimal,
                    emoji: sasCallbacks.sas.emoji,
                }
                : undefined,
            hasReciprocateQr: Boolean(session.reciprocateQrCallbacks),
            completed: phase === VerificationPhase.Done,
            error: session.error,
            createdAt: new Date(session.createdAtMs).toISOString(),
            updatedAt: new Date(session.updatedAtMs).toISOString(),
        };
    }
    findVerificationSession(id) {
        const direct = this.verificationSessions.get(id);
        if (direct) {
            return direct;
        }
        for (const session of this.verificationSessions.values()) {
            const txId = this.readRequestValue(session.request, () => session.request.transactionId, "");
            if (txId === id) {
                return session;
            }
        }
        throw new Error(`Matrix verification request not found: ${id}`);
    }
    ensureVerificationRequestTracked(session) {
        const requestObj = session.request;
        if (this.trackedVerificationRequests.has(requestObj)) {
            return;
        }
        this.trackedVerificationRequests.add(requestObj);
        session.request.on(VerificationRequestEvent.Change, () => {
            this.touchVerificationSession(session);
            this.maybeAutoAcceptInboundRequest(session);
            const verifier = this.readRequestValue(session.request, () => session.request.verifier, null);
            if (verifier) {
                this.attachVerifierToVerificationSession(session, verifier);
            }
            this.maybeAutoStartInboundSas(session);
        });
    }
    maybeAutoAcceptInboundRequest(session) {
        if (session.acceptRequested) {
            return;
        }
        const request = session.request;
        const isSelfVerification = this.readRequestValue(request, () => request.isSelfVerification, false);
        const initiatedByMe = this.readRequestValue(request, () => request.initiatedByMe, false);
        const phase = this.readRequestValue(request, () => request.phase, VerificationPhase.Requested);
        const accepting = this.readRequestValue(request, () => request.accepting, false);
        const declining = this.readRequestValue(request, () => request.declining, false);
        if (isSelfVerification || initiatedByMe) {
            return;
        }
        if (phase !== VerificationPhase.Requested || accepting || declining) {
            return;
        }
        session.acceptRequested = true;
        void request
            .accept()
            .then(() => {
            this.touchVerificationSession(session);
        })
            .catch((err) => {
            session.acceptRequested = false;
            session.error = err instanceof Error ? err.message : String(err);
            this.touchVerificationSession(session);
        });
    }
    maybeAutoStartInboundSas(session) {
        if (session.activeVerifier || session.verifyStarted || session.startRequested) {
            return;
        }
        if (this.readRequestValue(session.request, () => session.request.initiatedByMe, true)) {
            return;
        }
        if (!this.readRequestValue(session.request, () => session.request.isSelfVerification, false)) {
            return;
        }
        const phase = this.readRequestValue(session.request, () => session.request.phase, VerificationPhase.Requested);
        if (phase < VerificationPhase.Ready || phase >= VerificationPhase.Cancelled) {
            return;
        }
        const methodsRaw = this.readRequestValue(session.request, () => session.request.methods, []);
        const methods = Array.isArray(methodsRaw)
            ? methodsRaw.filter((entry) => typeof entry === "string")
            : [];
        const chosenMethod = this.readRequestValue(session.request, () => session.request.chosenMethod, null);
        const supportsSas = methods.includes(VerificationMethod.Sas) || chosenMethod === VerificationMethod.Sas;
        if (!supportsSas) {
            return;
        }
        session.startRequested = true;
        void session.request
            .startVerification(VerificationMethod.Sas)
            .then((verifier) => {
            this.attachVerifierToVerificationSession(session, verifier);
            this.touchVerificationSession(session);
        })
            .catch(() => {
            session.startRequested = false;
        });
    }
    attachVerifierToVerificationSession(session, verifier) {
        session.activeVerifier = verifier;
        this.touchVerificationSession(session);
        const maybeSas = verifier.getShowSasCallbacks();
        if (maybeSas) {
            session.sasCallbacks = maybeSas;
            this.maybeAutoConfirmSas(session);
        }
        const maybeReciprocateQr = verifier.getReciprocateQrCodeCallbacks();
        if (maybeReciprocateQr) {
            session.reciprocateQrCallbacks = maybeReciprocateQr;
        }
        const verifierObj = verifier;
        if (this.trackedVerificationVerifiers.has(verifierObj)) {
            this.ensureVerificationStarted(session);
            return;
        }
        this.trackedVerificationVerifiers.add(verifierObj);
        verifier.on(VerifierEvent.ShowSas, (sas) => {
            session.sasCallbacks = sas;
            this.touchVerificationSession(session);
            this.maybeAutoConfirmSas(session);
        });
        verifier.on(VerifierEvent.ShowReciprocateQr, (qr) => {
            session.reciprocateQrCallbacks = qr;
            this.touchVerificationSession(session);
        });
        verifier.on(VerifierEvent.Cancel, (err) => {
            this.clearSasAutoConfirmTimer(session);
            session.error = err instanceof Error ? err.message : String(err);
            this.touchVerificationSession(session);
        });
        this.ensureVerificationStarted(session);
    }
    maybeAutoConfirmSas(session) {
        if (session.sasAutoConfirmStarted || session.sasAutoConfirmTimer) {
            return;
        }
        if (this.readRequestValue(session.request, () => session.request.initiatedByMe, true)) {
            return;
        }
        const callbacks = session.sasCallbacks ?? session.activeVerifier?.getShowSasCallbacks();
        if (!callbacks) {
            return;
        }
        session.sasCallbacks = callbacks;
        // Give the remote client a moment to surface the compare-emoji UI before
        // we send our MAC and finish our side of the SAS flow.
        session.sasAutoConfirmTimer = setTimeout(() => {
            session.sasAutoConfirmTimer = undefined;
            const phase = this.readRequestValue(session.request, () => session.request.phase, VerificationPhase.Requested);
            if (phase >= VerificationPhase.Cancelled) {
                return;
            }
            session.sasAutoConfirmStarted = true;
            void callbacks
                .confirm()
                .then(() => {
                this.touchVerificationSession(session);
            })
                .catch((err) => {
                session.error = err instanceof Error ? err.message : String(err);
                this.touchVerificationSession(session);
            });
        }, SAS_AUTO_CONFIRM_DELAY_MS);
    }
    ensureVerificationStarted(session) {
        if (!session.activeVerifier || session.verifyStarted) {
            return;
        }
        session.verifyStarted = true;
        const verifier = session.activeVerifier;
        session.verifyPromise = verifier
            .verify()
            .then(() => {
            this.touchVerificationSession(session);
        })
            .catch((err) => {
            session.error = err instanceof Error ? err.message : String(err);
            this.touchVerificationSession(session);
        });
    }
    onSummaryChanged(listener) {
        this.summaryListeners.add(listener);
        return () => {
            this.summaryListeners.delete(listener);
        };
    }
    trackVerificationRequest(request) {
        this.pruneVerificationSessions(Date.now());
        const txId = this.readRequestValue(request, () => request.transactionId?.trim(), "");
        if (txId) {
            for (const existing of this.verificationSessions.values()) {
                const existingTxId = this.readRequestValue(existing.request, () => existing.request.transactionId, "");
                if (existingTxId === txId) {
                    existing.request = request;
                    this.ensureVerificationRequestTracked(existing);
                    const verifier = this.readRequestValue(request, () => request.verifier, null);
                    if (verifier) {
                        this.attachVerifierToVerificationSession(existing, verifier);
                    }
                    this.touchVerificationSession(existing);
                    return this.buildVerificationSummary(existing);
                }
            }
        }
        const now = Date.now();
        const id = `verification-${++this.verificationSessionCounter}`;
        const session = {
            id,
            request,
            createdAtMs: now,
            updatedAtMs: now,
            verifyStarted: false,
            startRequested: false,
            acceptRequested: false,
            sasAutoConfirmStarted: false,
        };
        this.verificationSessions.set(session.id, session);
        this.ensureVerificationRequestTracked(session);
        this.maybeAutoAcceptInboundRequest(session);
        const verifier = this.readRequestValue(request, () => request.verifier, null);
        if (verifier) {
            this.attachVerifierToVerificationSession(session, verifier);
        }
        this.maybeAutoStartInboundSas(session);
        this.emitVerificationSummary(session);
        return this.buildVerificationSummary(session);
    }
    async requestOwnUserVerification(crypto) {
        if (!crypto) {
            return null;
        }
        const request = (await crypto.requestOwnUserVerification());
        if (!request) {
            return null;
        }
        return this.trackVerificationRequest(request);
    }
    listVerifications() {
        this.pruneVerificationSessions(Date.now());
        const summaries = Array.from(this.verificationSessions.values()).map((session) => this.buildVerificationSummary(session));
        return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    async requestVerification(crypto, params) {
        if (!crypto) {
            throw new Error("Matrix crypto is not available");
        }
        let request = null;
        if (params.ownUser) {
            request = (await crypto.requestOwnUserVerification());
        }
        else if (params.userId && params.deviceId && crypto.requestDeviceVerification) {
            request = await crypto.requestDeviceVerification(params.userId, params.deviceId);
        }
        else if (params.userId && params.roomId && crypto.requestVerificationDM) {
            request = await crypto.requestVerificationDM(params.userId, params.roomId);
        }
        else {
            throw new Error("Matrix verification request requires one of: ownUser, userId+deviceId, or userId+roomId");
        }
        if (!request) {
            throw new Error("Matrix verification request could not be created");
        }
        return this.trackVerificationRequest(request);
    }
    async acceptVerification(id) {
        const session = this.findVerificationSession(id);
        await session.request.accept();
        this.touchVerificationSession(session);
        return this.buildVerificationSummary(session);
    }
    async cancelVerification(id, params) {
        const session = this.findVerificationSession(id);
        await session.request.cancel(params);
        this.touchVerificationSession(session);
        return this.buildVerificationSummary(session);
    }
    async startVerification(id, method = "sas") {
        const session = this.findVerificationSession(id);
        if (method !== "sas") {
            throw new Error("Matrix startVerification currently supports only SAS directly");
        }
        const verifier = await session.request.startVerification(VerificationMethod.Sas);
        this.attachVerifierToVerificationSession(session, verifier);
        this.ensureVerificationStarted(session);
        return this.buildVerificationSummary(session);
    }
    async generateVerificationQr(id) {
        const session = this.findVerificationSession(id);
        const qr = await session.request.generateQRCode();
        if (!qr) {
            throw new Error("Matrix verification QR data is not available yet");
        }
        return { qrDataBase64: Buffer.from(qr).toString("base64") };
    }
    async scanVerificationQr(id, qrDataBase64) {
        const session = this.findVerificationSession(id);
        const trimmed = qrDataBase64.trim();
        if (!trimmed) {
            throw new Error("Matrix verification QR payload is required");
        }
        const qrBytes = Buffer.from(trimmed, "base64");
        if (qrBytes.length === 0) {
            throw new Error("Matrix verification QR payload is invalid base64");
        }
        const verifier = await session.request.scanQRCode(new Uint8ClampedArray(qrBytes));
        this.attachVerifierToVerificationSession(session, verifier);
        this.ensureVerificationStarted(session);
        return this.buildVerificationSummary(session);
    }
    async confirmVerificationSas(id) {
        const session = this.findVerificationSession(id);
        const callbacks = session.sasCallbacks ?? session.activeVerifier?.getShowSasCallbacks();
        if (!callbacks) {
            throw new Error("Matrix SAS confirmation is not available for this verification request");
        }
        this.clearSasAutoConfirmTimer(session);
        session.sasCallbacks = callbacks;
        session.sasAutoConfirmStarted = true;
        await callbacks.confirm();
        this.touchVerificationSession(session);
        return this.buildVerificationSummary(session);
    }
    mismatchVerificationSas(id) {
        const session = this.findVerificationSession(id);
        const callbacks = session.sasCallbacks ?? session.activeVerifier?.getShowSasCallbacks();
        if (!callbacks) {
            throw new Error("Matrix SAS mismatch is not available for this verification request");
        }
        this.clearSasAutoConfirmTimer(session);
        session.sasCallbacks = callbacks;
        callbacks.mismatch();
        this.touchVerificationSession(session);
        return this.buildVerificationSummary(session);
    }
    confirmVerificationReciprocateQr(id) {
        const session = this.findVerificationSession(id);
        const callbacks = session.reciprocateQrCallbacks ?? session.activeVerifier?.getReciprocateQrCodeCallbacks();
        if (!callbacks) {
            throw new Error("Matrix reciprocate-QR confirmation is not available for this verification request");
        }
        session.reciprocateQrCallbacks = callbacks;
        callbacks.confirm();
        this.touchVerificationSession(session);
        return this.buildVerificationSummary(session);
    }
    getVerificationSas(id) {
        const session = this.findVerificationSession(id);
        const callbacks = session.sasCallbacks ?? session.activeVerifier?.getShowSasCallbacks();
        if (!callbacks) {
            throw new Error("Matrix SAS data is not available for this verification request");
        }
        session.sasCallbacks = callbacks;
        return {
            decimal: callbacks.sas.decimal,
            emoji: callbacks.sas.emoji,
        };
    }
}
