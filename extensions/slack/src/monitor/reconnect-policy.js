const SLACK_AUTH_ERROR_RE = /account_inactive|invalid_auth|token_revoked|token_expired|not_authed|org_login_required|team_access_not_granted|missing_scope|cannot_find_service|invalid_token/i;
export const SLACK_SOCKET_RECONNECT_POLICY = {
    initialMs: 2_000,
    maxMs: 30_000,
    factor: 1.8,
    jitter: 0.25,
    maxAttempts: 12,
};
export function getSocketEmitter(app) {
    const receiver = app.receiver;
    const client = receiver && typeof receiver === "object"
        ? receiver.client
        : undefined;
    if (!client || typeof client !== "object") {
        return null;
    }
    const on = client.on;
    const off = client.off;
    if (typeof on !== "function" || typeof off !== "function") {
        return null;
    }
    return {
        on: (event, listener) => on.call(client, event, listener),
        off: (event, listener) => off.call(client, event, listener),
    };
}
export function waitForSlackSocketDisconnect(app, abortSignal) {
    return new Promise((resolve) => {
        const emitter = getSocketEmitter(app);
        if (!emitter) {
            abortSignal?.addEventListener("abort", () => resolve({ event: "disconnect" }), {
                once: true,
            });
            return;
        }
        const disconnectListener = () => resolveOnce({ event: "disconnect" });
        const startFailListener = (error) => resolveOnce({ event: "unable_to_socket_mode_start", error });
        const errorListener = (error) => resolveOnce({ event: "error", error });
        const abortListener = () => resolveOnce({ event: "disconnect" });
        const cleanup = () => {
            emitter.off("disconnected", disconnectListener);
            emitter.off("unable_to_socket_mode_start", startFailListener);
            emitter.off("error", errorListener);
            abortSignal?.removeEventListener("abort", abortListener);
        };
        const resolveOnce = (value) => {
            cleanup();
            resolve(value);
        };
        emitter.on("disconnected", disconnectListener);
        emitter.on("unable_to_socket_mode_start", startFailListener);
        emitter.on("error", errorListener);
        abortSignal?.addEventListener("abort", abortListener, { once: true });
    });
}
/**
 * Detect non-recoverable Slack API / auth errors that should NOT be retried.
 * These indicate permanent credential problems (revoked bot, deactivated account, etc.)
 * and retrying will never succeed — continuing to retry blocks the entire gateway.
 */
export function isNonRecoverableSlackAuthError(error) {
    const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return SLACK_AUTH_ERROR_RE.test(msg);
}
export function formatUnknownError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return "unknown error";
    }
}
