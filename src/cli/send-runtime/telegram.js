import { sendMessageTelegram as sendMessageTelegramImpl } from "../../plugin-sdk/telegram-runtime.js";
export const runtimeSend = {
    sendMessage: sendMessageTelegramImpl,
};
