export function attachEmitterListener(emitter, event, listener) {
    emitter.on(event, listener);
    return () => {
        if (typeof emitter.off === "function") {
            emitter.off(event, listener);
            return;
        }
        if (typeof emitter.removeListener === "function") {
            emitter.removeListener(event, listener);
        }
    };
}
export function closeInboundMonitorSocket(sock) {
    sock.ws?.close?.();
}
