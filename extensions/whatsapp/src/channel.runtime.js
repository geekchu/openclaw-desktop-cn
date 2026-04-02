import { getActiveWebListener as getActiveWebListenerImpl } from "./active-listener.js";
import { getWebAuthAgeMs as getWebAuthAgeMsImpl, logWebSelfId as logWebSelfIdImpl, logoutWeb as logoutWebImpl, readWebSelfId as readWebSelfIdImpl, webAuthExists as webAuthExistsImpl, } from "./auth-store.js";
import { monitorWebChannel as monitorWebChannelImpl } from "./auto-reply/monitor.js";
import { loginWeb as loginWebImpl } from "./login.js";
import { whatsappSetupWizard as whatsappSetupWizardImpl } from "./setup-surface.js";
let loginQrPromise = null;
function loadWhatsAppLoginQr() {
    loginQrPromise ??= import("./login-qr.js");
    return loginQrPromise;
}
export function getActiveWebListener(...args) {
    return getActiveWebListenerImpl(...args);
}
export function getWebAuthAgeMs(...args) {
    return getWebAuthAgeMsImpl(...args);
}
export function logWebSelfId(...args) {
    return logWebSelfIdImpl(...args);
}
export function logoutWeb(...args) {
    return logoutWebImpl(...args);
}
export function readWebSelfId(...args) {
    return readWebSelfIdImpl(...args);
}
export function webAuthExists(...args) {
    return webAuthExistsImpl(...args);
}
export function loginWeb(...args) {
    return loginWebImpl(...args);
}
export async function startWebLoginWithQr(...args) {
    const { startWebLoginWithQr } = await loadWhatsAppLoginQr();
    return await startWebLoginWithQr(...args);
}
export async function waitForWebLogin(...args) {
    const { waitForWebLogin } = await loadWhatsAppLoginQr();
    return await waitForWebLogin(...args);
}
export const whatsappSetupWizard = { ...whatsappSetupWizardImpl };
export function monitorWebChannel(...args) {
    return monitorWebChannelImpl(...args);
}
