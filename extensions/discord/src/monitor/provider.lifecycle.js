import { danger } from "openclaw/plugin-sdk/runtime-env";
import { attachDiscordGatewayLogging } from "../gateway-logging.js";
import { getDiscordGatewayEmitter, waitForDiscordGatewayStop } from "../monitor.gateway.js";
import { registerGateway, unregisterGateway } from "./gateway-registry.js";
import { createDiscordGatewayReconnectController } from "./provider.lifecycle.reconnect.js";
export async function runDiscordGatewayLifecycle(params) {
    const gateway = params.gateway;
    if (gateway) {
        registerGateway(params.accountId, gateway);
    }
    const gatewayEmitter = params.gatewaySupervisor.emitter ?? getDiscordGatewayEmitter(gateway);
    const stopGatewayLogging = attachDiscordGatewayLogging({
        emitter: gatewayEmitter,
        runtime: params.runtime,
    });
    let lifecycleStopping = false;
    const pushStatus = (patch) => {
        params.statusSink?.(patch);
    };
    const reconnectController = createDiscordGatewayReconnectController({
        accountId: params.accountId,
        gateway,
        runtime: params.runtime,
        abortSignal: params.abortSignal,
        pushStatus,
        isLifecycleStopping: () => lifecycleStopping,
        drainPendingGatewayErrors: () => drainPendingGatewayErrors(),
    });
    const onGatewayDebug = reconnectController.onGatewayDebug;
    gatewayEmitter?.on("debug", onGatewayDebug);
    let sawDisallowedIntents = false;
    const handleGatewayEvent = (event) => {
        if (event.type === "disallowed-intents") {
            sawDisallowedIntents = true;
            params.runtime.error?.(danger("discord: gateway closed with code 4014 (missing privileged gateway intents). Enable the required intents in the Discord Developer Portal or disable them in config."));
            return "stop";
        }
        // When we deliberately set maxAttempts=0 and disconnected (health-monitor
        // stale-socket restart), Carbon fires "Max reconnect attempts (0)". This
        // is expected — log at info instead of error to avoid false alarms.
        if (lifecycleStopping && event.type === "reconnect-exhausted") {
            params.runtime.log?.(`discord: ignoring expected reconnect-exhausted during shutdown: ${event.message}`);
            return "stop";
        }
        params.runtime.error?.(danger(`discord gateway error: ${event.message}`));
        return event.shouldStopLifecycle ? "stop" : "continue";
    };
    const drainPendingGatewayErrors = () => params.gatewaySupervisor.drainPending((event) => {
        const decision = handleGatewayEvent(event);
        if (decision !== "stop") {
            return "continue";
        }
        // Don't throw for expected shutdown events. `reconnect-exhausted` can be
        // queued just before an abort-driven shutdown flips `lifecycleStopping`,
        // so only suppress it when shutdown is already underway.
        if (event.type === "disallowed-intents" ||
            (event.type === "reconnect-exhausted" &&
                (lifecycleStopping || params.abortSignal?.aborted === true))) {
            return "stop";
        }
        throw event.err;
    });
    try {
        if (params.execApprovalsHandler) {
            await params.execApprovalsHandler.start();
        }
        // Drain gateway errors emitted before lifecycle listeners were attached.
        if (drainPendingGatewayErrors() === "stop") {
            return;
        }
        await reconnectController.ensureStartupReady();
        if (drainPendingGatewayErrors() === "stop") {
            return;
        }
        await waitForDiscordGatewayStop({
            gateway: gateway
                ? {
                    disconnect: () => gateway.disconnect(),
                }
                : undefined,
            abortSignal: params.abortSignal,
            gatewaySupervisor: params.gatewaySupervisor,
            onGatewayEvent: handleGatewayEvent,
            registerForceStop: reconnectController.registerForceStop,
        });
    }
    catch (err) {
        if (!sawDisallowedIntents && !params.isDisallowedIntentsError(err)) {
            throw err;
        }
    }
    finally {
        lifecycleStopping = true;
        params.gatewaySupervisor.detachLifecycle();
        unregisterGateway(params.accountId);
        stopGatewayLogging();
        reconnectController.dispose();
        gatewayEmitter?.removeListener("debug", onGatewayDebug);
        if (params.voiceManager) {
            await params.voiceManager.destroy();
            params.voiceManagerRef.current = null;
        }
        if (params.execApprovalsHandler) {
            await params.execApprovalsHandler.stop();
        }
        params.threadBindings.stop();
    }
}
