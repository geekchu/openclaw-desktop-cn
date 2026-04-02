import { sendMessageSignal as sendMessageSignalImpl } from "../../plugin-sdk/signal.js";
export const runtimeSend = {
    sendMessage: sendMessageSignalImpl,
};
