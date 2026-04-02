import { normalizeDiscordSlug } from "./monitor/allow-list.js";
import { normalizeDiscordToken } from "./token.js";
export function resolveDiscordAllowlistToken(token) {
    return normalizeDiscordToken(token, "channels.discord.token");
}
export function buildDiscordUnresolvedResults(entries, buildResult) {
    return entries.map((input) => buildResult(input));
}
export function findDiscordGuildByName(guilds, input) {
    const slug = normalizeDiscordSlug(input);
    if (!slug) {
        return undefined;
    }
    return guilds.find((guild) => guild.slug === slug);
}
export function filterDiscordGuilds(guilds, params) {
    if (params.guildId) {
        return guilds.filter((guild) => guild.id === params.guildId);
    }
    if (params.guildName) {
        const match = findDiscordGuildByName(guilds, params.guildName);
        return match ? [match] : [];
    }
    return guilds;
}
