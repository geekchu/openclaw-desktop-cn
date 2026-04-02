export function getDiscordGatewayEmitter(gateway) {
    return gateway?.emitter;
}
export async function waitForDiscordGatewayStop(params) {
    const { gateway, abortSignal } = params;
    return await new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            abortSignal?.removeEventListener("abort", onAbort);
            params.gatewaySupervisor?.detachLifecycle();
        };
        const finishResolve = () => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                gateway?.disconnect?.();
            }
            finally {
                // remove listeners after disconnect so late "error" events emitted
                // during disconnect are still handled instead of becoming uncaught
                cleanup();
                resolve();
            }
        };
        const finishReject = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                gateway?.disconnect?.();
            }
            finally {
                cleanup();
                reject(err);
            }
        };
        const onAbort = () => {
            finishResolve();
        };
        const onGatewayEvent = (event) => {
            const shouldStop = (params.onGatewayEvent?.(event) ?? "stop") === "stop";
            if (shouldStop) {
                finishReject(event.err);
            }
        };
        const onForceStop = (err) => {
            finishReject(err);
        };
        if (abortSignal?.aborted) {
            onAbort();
            return;
        }
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        params.gatewaySupervisor?.attachLifecycle(onGatewayEvent);
        params.registerForceStop?.(onForceStop);
    });
}
