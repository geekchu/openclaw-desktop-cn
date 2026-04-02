import { danger } from "openclaw/plugin-sdk/runtime-env";
import { getDiscordGatewayEmitter } from "../monitor.gateway.js";
export function classifyDiscordGatewayEvent(params) {
    const message = String(params.err);
    if (params.isDisallowedIntentsError(params.err)) {
        return {
            type: "disallowed-intents",
            err: params.err,
            message,
            shouldStopLifecycle: true,
        };
    }
    if (message.includes("Max reconnect attempts")) {
        return {
            type: "reconnect-exhausted",
            err: params.err,
            message,
            shouldStopLifecycle: true,
        };
    }
    if (message.includes("Fatal Gateway error")) {
        return {
            type: "fatal",
            err: params.err,
            message,
            shouldStopLifecycle: true,
        };
    }
    return {
        type: "other",
        err: params.err,
        message,
        shouldStopLifecycle: false,
    };
}
export function createDiscordGatewaySupervisor(params) {
    const emitter = getDiscordGatewayEmitter(params.gateway);
    const pending = [];
    if (!emitter) {
        return {
            attachLifecycle: () => { },
            detachLifecycle: () => { },
            drainPending: () => "continue",
            dispose: () => { },
            emitter,
        };
    }
    let lifecycleHandler;
    let phase = "buffering";
    const logLateEvent = (state) => (event) => {
        params.runtime.error?.(danger(`discord: suppressed late gateway ${event.type} error ${state === "disposed" ? "after dispose" : "during teardown"}: ${event.message}`));
    };
    const onGatewayError = (err) => {
        const event = classifyDiscordGatewayEvent({
            err,
            isDisallowedIntentsError: params.isDisallowedIntentsError,
        });
        switch (phase) {
            case "disposed":
                logLateEvent("disposed")(event);
                return;
            case "active":
                lifecycleHandler?.(event);
                return;
            case "teardown":
                logLateEvent("teardown")(event);
                return;
            case "buffering":
                pending.push(event);
                return;
        }
    };
    emitter.on("error", onGatewayError);
    return {
        emitter,
        attachLifecycle: (handler) => {
            lifecycleHandler = handler;
            phase = "active";
        },
        detachLifecycle: () => {
            lifecycleHandler = undefined;
            phase = "teardown";
        },
        drainPending: (handler) => {
            if (pending.length === 0) {
                return "continue";
            }
            const queued = [...pending];
            pending.length = 0;
            for (const event of queued) {
                if (handler(event) === "stop") {
                    return "stop";
                }
            }
            return "continue";
        },
        dispose: () => {
            if (phase === "disposed") {
                return;
            }
            lifecycleHandler = undefined;
            phase = "disposed";
            pending.length = 0;
        },
    };
}
