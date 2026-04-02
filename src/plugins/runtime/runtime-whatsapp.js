import { createRuntimeWhatsAppLoginTool, getActiveWebListener, getWebAuthAgeMs, handleWhatsAppAction, logWebSelfId, loginWeb, logoutWeb, monitorWebChannel, readWebSelfId, sendMessageWhatsApp, sendPollWhatsApp, startWebLoginWithQr, waitForWebLogin, webAuthExists, } from "./runtime-whatsapp-boundary.js";
export function createRuntimeWhatsApp() {
    return {
        getActiveWebListener,
        getWebAuthAgeMs,
        logoutWeb,
        logWebSelfId,
        readWebSelfId,
        webAuthExists,
        sendMessageWhatsApp,
        sendPollWhatsApp,
        loginWeb,
        startWebLoginWithQr,
        waitForWebLogin,
        monitorWebChannel,
        handleWhatsAppAction,
        createLoginTool: createRuntimeWhatsAppLoginTool,
    };
}
