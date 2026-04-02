import { monitorIMessageProvider, probeIMessage, sendMessageIMessage, } from "../../plugin-sdk/imessage.js";
export function createRuntimeIMessage() {
    return {
        monitorIMessageProvider,
        probeIMessage,
        sendMessageIMessage,
    };
}
