import {
  isNumericTelegramUserId,
  normalizeTelegramAllowFromEntry,
} from "../../extensions/telegram/src/allow-from.js";

export const auditChannelTelegramRuntime = {
  isNumericTelegramUserId,
  normalizeTelegramAllowFromEntry,
};
