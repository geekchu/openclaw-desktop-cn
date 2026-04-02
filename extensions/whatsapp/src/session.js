import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, makeWASocket, useMultiFileAuthState, } from "@whiskeysockets/baileys";
import { formatCliCommand } from "openclaw/plugin-sdk/cli-runtime";
import { VERSION } from "openclaw/plugin-sdk/cli-runtime";
import { danger, success } from "openclaw/plugin-sdk/runtime-env";
import { getChildLogger, toPinoLikeLogger } from "openclaw/plugin-sdk/runtime-env";
import { ensureDir, resolveUserPath } from "openclaw/plugin-sdk/text-runtime";
import qrcode from "qrcode-terminal";
import { maybeRestoreCredsFromBackup, readCredsJsonRaw, resolveDefaultWebAuthDir, resolveWebCredsBackupPath, resolveWebCredsPath, } from "./auth-store.js";
import { getStatusCode } from "./session-errors.js";
export { formatError, getStatusCode } from "./session-errors.js";
export { getWebAuthAgeMs, logoutWeb, logWebSelfId, pickWebChannel, readWebSelfId, WA_WEB_AUTH_DIR, webAuthExists, } from "./auth-store.js";
const LOGGED_OUT_STATUS = DisconnectReason?.loggedOut ?? 401;
// Per-authDir queues so multi-account creds saves don't block each other.
const credsSaveQueues = new Map();
const CREDS_SAVE_FLUSH_TIMEOUT_MS = 15_000;
function enqueueSaveCreds(authDir, saveCreds, logger) {
    const prev = credsSaveQueues.get(authDir) ?? Promise.resolve();
    const next = prev
        .then(() => safeSaveCreds(authDir, saveCreds, logger))
        .catch((err) => {
        logger.warn({ error: String(err) }, "WhatsApp creds save queue error");
    })
        .finally(() => {
        if (credsSaveQueues.get(authDir) === next)
            credsSaveQueues.delete(authDir);
    });
    credsSaveQueues.set(authDir, next);
}
async function safeSaveCreds(authDir, saveCreds, logger) {
    try {
        // Best-effort backup so we can recover after abrupt restarts.
        // Important: don't clobber a good backup with a corrupted/truncated creds.json.
        const credsPath = resolveWebCredsPath(authDir);
        const backupPath = resolveWebCredsBackupPath(authDir);
        const raw = readCredsJsonRaw(credsPath);
        if (raw) {
            try {
                JSON.parse(raw);
                fsSync.copyFileSync(credsPath, backupPath);
                try {
                    fsSync.chmodSync(backupPath, 0o600);
                }
                catch {
                    // best-effort on platforms that support it
                }
            }
            catch {
                // keep existing backup
            }
        }
    }
    catch {
        // ignore backup failures
    }
    try {
        await Promise.resolve(saveCreds());
        try {
            fsSync.chmodSync(resolveWebCredsPath(authDir), 0o600);
        }
        catch {
            // best-effort on platforms that support it
        }
    }
    catch (err) {
        logger.warn({ error: String(err) }, "failed saving WhatsApp creds");
    }
}
/**
 * Create a Baileys socket backed by the multi-file auth store we keep on disk.
 * Consumers can opt into QR printing for interactive login flows.
 */
export async function createWaSocket(printQr, verbose, opts = {}) {
    const baseLogger = getChildLogger({ module: "baileys" }, {
        level: verbose ? "info" : "silent",
    });
    const logger = toPinoLikeLogger(baseLogger, verbose ? "info" : "silent");
    const authDir = resolveUserPath(opts.authDir ?? resolveDefaultWebAuthDir());
    await ensureDir(authDir);
    const sessionLogger = getChildLogger({ module: "web-session" });
    maybeRestoreCredsFromBackup(authDir);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        version,
        logger,
        printQRInTerminal: false,
        browser: ["openclaw", "cli", VERSION],
        syncFullHistory: false,
        markOnlineOnConnect: false,
    });
    sock.ev.on("creds.update", () => enqueueSaveCreds(authDir, saveCreds, sessionLogger));
    sock.ev.on("connection.update", (update) => {
        try {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                opts.onQr?.(qr);
                if (printQr) {
                    console.log("Scan this QR in WhatsApp (Linked Devices):");
                    qrcode.generate(qr, { small: true });
                }
            }
            if (connection === "close") {
                const status = getStatusCode(lastDisconnect?.error);
                if (status === LOGGED_OUT_STATUS) {
                    console.error(danger(`WhatsApp session logged out. Run: ${formatCliCommand("openclaw channels login")}`));
                }
            }
            if (connection === "open" && verbose) {
                console.log(success("WhatsApp Web connected."));
            }
        }
        catch (err) {
            sessionLogger.error({ error: String(err) }, "connection.update handler error");
        }
    });
    // Handle WebSocket-level errors to prevent unhandled exceptions from crashing the process
    if (sock.ws && typeof sock.ws.on === "function") {
        sock.ws.on("error", (err) => {
            sessionLogger.error({ error: String(err) }, "WebSocket error");
        });
    }
    return sock;
}
export async function waitForWaConnection(sock) {
    return new Promise((resolve, reject) => {
        const evWithOff = sock.ev;
        const handler = (...args) => {
            const update = (args[0] ?? {});
            if (update.connection === "open") {
                evWithOff.off?.("connection.update", handler);
                resolve();
            }
            if (update.connection === "close") {
                evWithOff.off?.("connection.update", handler);
                reject(update.lastDisconnect ?? new Error("Connection closed"));
            }
        };
        sock.ev.on("connection.update", handler);
    });
}
/** Await pending credential saves — scoped to one authDir, or all if omitted. */
export function waitForCredsSaveQueue(authDir) {
    if (authDir) {
        return credsSaveQueues.get(authDir) ?? Promise.resolve();
    }
    return Promise.all(credsSaveQueues.values()).then(() => { });
}
/** Await pending credential saves, but don't hang forever on stalled I/O. */
export async function waitForCredsSaveQueueWithTimeout(authDir, timeoutMs = CREDS_SAVE_FLUSH_TIMEOUT_MS) {
    let flushTimeout;
    await Promise.race([
        waitForCredsSaveQueue(authDir),
        new Promise((resolve) => {
            flushTimeout = setTimeout(resolve, timeoutMs);
        }),
    ]).finally(() => {
        if (flushTimeout) {
            clearTimeout(flushTimeout);
        }
    });
}
export function newConnectionId() {
    return randomUUID();
}
