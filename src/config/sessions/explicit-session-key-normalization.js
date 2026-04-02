import { normalizeExplicitDiscordSessionKey } from "../../plugin-sdk/discord.js";
const EXPLICIT_SESSION_KEY_NORMALIZERS = [
    {
        provider: "discord",
        normalize: normalizeExplicitDiscordSessionKey,
        matches: ({ sessionKey, provider, surface, from }) => surface === "discord" ||
            provider === "discord" ||
            from.startsWith("discord:") ||
            sessionKey.startsWith("discord:") ||
            sessionKey.includes(":discord:"),
    },
];
function resolveExplicitSessionKeyNormalizer(sessionKey, ctx) {
    const normalizedProvider = ctx.Provider?.trim().toLowerCase();
    const normalizedSurface = ctx.Surface?.trim().toLowerCase();
    const normalizedFrom = (ctx.From ?? "").trim().toLowerCase();
    return EXPLICIT_SESSION_KEY_NORMALIZERS.find((entry) => entry.matches({
        sessionKey,
        provider: normalizedProvider,
        surface: normalizedSurface,
        from: normalizedFrom,
    }))?.normalize;
}
export function normalizeExplicitSessionKey(sessionKey, ctx) {
    const normalized = sessionKey.trim().toLowerCase();
    const normalize = resolveExplicitSessionKeyNormalizer(normalized, ctx);
    return normalize ? normalize(normalized, ctx) : normalized;
}
