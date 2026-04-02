import { inspectTelegramAccount as inspectTelegramAccountImpl } from "../plugin-sdk/telegram-runtime.js";
export function inspectTelegramAccount(...args) {
    return inspectTelegramAccountImpl(...args);
}
