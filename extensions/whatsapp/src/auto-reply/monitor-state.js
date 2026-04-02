import { createConnectedChannelStatusPatch } from "openclaw/plugin-sdk/gateway-runtime";
function cloneStatus(status) {
    return {
        ...status,
        lastDisconnect: status.lastDisconnect ? { ...status.lastDisconnect } : null,
    };
}
function isTerminalHealthState(healthState) {
    return healthState === "conflict" || healthState === "logged-out" || healthState === "stopped";
}
export function createWebChannelStatusController(statusSink) {
    const status = {
        running: true,
        connected: false,
        reconnectAttempts: 0,
        lastConnectedAt: null,
        lastDisconnect: null,
        lastInboundAt: null,
        lastMessageAt: null,
        lastEventAt: null,
        lastError: null,
        healthState: "starting",
    };
    const emit = () => {
        statusSink?.(cloneStatus(status));
    };
    return {
        emit,
        snapshot: () => status,
        noteConnected(at = Date.now()) {
            Object.assign(status, createConnectedChannelStatusPatch(at));
            status.lastError = null;
            status.healthState = "healthy";
            emit();
        },
        noteInbound(at = Date.now()) {
            status.lastInboundAt = at;
            status.lastMessageAt = at;
            status.lastEventAt = at;
            if (status.connected) {
                status.healthState = "healthy";
            }
            emit();
        },
        noteWatchdogStale(at = Date.now()) {
            status.lastEventAt = at;
            if (status.connected) {
                status.healthState = "stale";
            }
            emit();
        },
        noteReconnectAttempts(reconnectAttempts) {
            status.reconnectAttempts = reconnectAttempts;
            emit();
        },
        noteClose(params) {
            const at = params.at ?? Date.now();
            status.connected = false;
            status.lastEventAt = at;
            status.lastDisconnect = {
                at,
                status: params.statusCode,
                error: params.error,
                loggedOut: Boolean(params.loggedOut),
            };
            status.lastError = params.error ?? null;
            status.reconnectAttempts = params.reconnectAttempts;
            status.healthState = params.healthState;
            emit();
        },
        markStopped(at = Date.now()) {
            status.running = false;
            status.connected = false;
            status.lastEventAt = at;
            if (!isTerminalHealthState(status.healthState)) {
                status.healthState = "stopped";
            }
            emit();
        },
    };
}
