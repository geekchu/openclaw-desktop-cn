import { sendMessageWhatsApp as sendMessageWhatsAppImpl } from "../../plugins/runtime/runtime-whatsapp-boundary.js";
export const runtimeSend = {
    sendMessage: sendMessageWhatsAppImpl,
};
