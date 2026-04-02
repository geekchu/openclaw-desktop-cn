import { Routes } from "discord-api-types/v10";
import { resolveDiscordRest } from "./client.js";
export async function sendTypingDiscord(channelId, opts = {}) {
    const rest = resolveDiscordRest(opts);
    await rest.post(Routes.channelTyping(channelId));
    return { ok: true, channelId };
}
