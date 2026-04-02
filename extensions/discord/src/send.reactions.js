import { Routes } from "discord-api-types/v10";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { buildReactionIdentifier, createDiscordClient, formatReactionEmoji, normalizeReactionEmoji, } from "./send.shared.js";
export async function reactMessageDiscord(channelId, messageId, emoji, opts = {}) {
    const cfg = opts.cfg ?? loadConfig();
    const { rest, request } = createDiscordClient(opts, cfg);
    const encoded = normalizeReactionEmoji(emoji);
    await request(() => rest.put(Routes.channelMessageOwnReaction(channelId, messageId, encoded)), "react");
    return { ok: true };
}
export async function removeReactionDiscord(channelId, messageId, emoji, opts = {}) {
    const cfg = opts.cfg ?? loadConfig();
    const { rest } = createDiscordClient(opts, cfg);
    const encoded = normalizeReactionEmoji(emoji);
    await rest.delete(Routes.channelMessageOwnReaction(channelId, messageId, encoded));
    return { ok: true };
}
export async function removeOwnReactionsDiscord(channelId, messageId, opts = {}) {
    const cfg = opts.cfg ?? loadConfig();
    const { rest } = createDiscordClient(opts, cfg);
    const message = (await rest.get(Routes.channelMessage(channelId, messageId)));
    const identifiers = new Set();
    for (const reaction of message.reactions ?? []) {
        const identifier = buildReactionIdentifier(reaction.emoji);
        if (identifier) {
            identifiers.add(identifier);
        }
    }
    if (identifiers.size === 0) {
        return { ok: true, removed: [] };
    }
    const removed = [];
    await Promise.allSettled(Array.from(identifiers, (identifier) => {
        removed.push(identifier);
        return rest.delete(Routes.channelMessageOwnReaction(channelId, messageId, normalizeReactionEmoji(identifier)));
    }));
    return { ok: true, removed };
}
export async function fetchReactionsDiscord(channelId, messageId, opts = {}) {
    const cfg = opts.cfg ?? loadConfig();
    const { rest } = createDiscordClient(opts, cfg);
    const message = (await rest.get(Routes.channelMessage(channelId, messageId)));
    const reactions = message.reactions ?? [];
    if (reactions.length === 0) {
        return [];
    }
    const limit = typeof opts.limit === "number" && Number.isFinite(opts.limit)
        ? Math.min(Math.max(Math.floor(opts.limit), 1), 100)
        : 100;
    const summaries = [];
    for (const reaction of reactions) {
        const identifier = buildReactionIdentifier(reaction.emoji);
        if (!identifier) {
            continue;
        }
        const encoded = encodeURIComponent(identifier);
        const users = (await rest.get(Routes.channelMessageReaction(channelId, messageId, encoded), {
            limit,
        }));
        summaries.push({
            emoji: {
                id: reaction.emoji.id ?? null,
                name: reaction.emoji.name ?? null,
                raw: formatReactionEmoji(reaction.emoji),
            },
            count: reaction.count,
            users: users.map((user) => ({
                id: user.id,
                username: user.username,
                tag: user.username && user.discriminator
                    ? `${user.username}#${user.discriminator}`
                    : user.username,
            })),
        });
    }
    return summaries;
}
export { fetchChannelPermissionsDiscord } from "./send.permissions.js";
