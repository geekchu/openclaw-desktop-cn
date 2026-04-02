import { inspectDiscordAccount as inspectDiscordAccountImpl } from "../plugin-sdk/discord.js";
export function inspectDiscordAccount(...args) {
    return inspectDiscordAccountImpl(...args);
}
