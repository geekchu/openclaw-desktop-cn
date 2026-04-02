import { monitorSignalProvider, probeSignal, signalMessageActions, sendMessageSignal, } from "../../plugin-sdk/signal.js";
export function createRuntimeSignal() {
    return {
        probeSignal,
        sendMessageSignal,
        monitorSignalProvider,
        messageActions: signalMessageActions,
    };
}
