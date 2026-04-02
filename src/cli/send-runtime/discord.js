import { sendMessageDiscord as sendMessageDiscordImpl } from "../../plugin-sdk/discord.js";
export const runtimeSend = {
    sendMessage: sendMessageDiscordImpl,
};
