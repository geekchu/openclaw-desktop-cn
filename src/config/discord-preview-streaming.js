function normalizeStreamingMode(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    return normalized || null;
}
export function parseStreamingMode(value) {
    const normalized = normalizeStreamingMode(value);
    if (normalized === "off" ||
        normalized === "partial" ||
        normalized === "block" ||
        normalized === "progress") {
        return normalized;
    }
    return null;
}
export function parseDiscordPreviewStreamMode(value) {
    const parsed = parseStreamingMode(value);
    if (!parsed) {
        return null;
    }
    return parsed === "progress" ? "partial" : parsed;
}
export function parseSlackLegacyDraftStreamMode(value) {
    const normalized = normalizeStreamingMode(value);
    if (normalized === "replace" || normalized === "status_final" || normalized === "append") {
        return normalized;
    }
    return null;
}
export function mapSlackLegacyDraftStreamModeToStreaming(mode) {
    if (mode === "append") {
        return "block";
    }
    if (mode === "status_final") {
        return "progress";
    }
    return "partial";
}
export function mapStreamingModeToSlackLegacyDraftStreamMode(mode) {
    if (mode === "block") {
        return "append";
    }
    if (mode === "progress") {
        return "status_final";
    }
    return "replace";
}
export function resolveTelegramPreviewStreamMode(params = {}) {
    const parsedStreaming = parseStreamingMode(params.streaming);
    if (parsedStreaming) {
        if (parsedStreaming === "progress") {
            return "partial";
        }
        return parsedStreaming;
    }
    const legacy = parseDiscordPreviewStreamMode(params.streamMode);
    if (legacy) {
        return legacy;
    }
    if (typeof params.streaming === "boolean") {
        return params.streaming ? "partial" : "off";
    }
    return "partial";
}
export function resolveDiscordPreviewStreamMode(params = {}) {
    const parsedStreaming = parseDiscordPreviewStreamMode(params.streaming);
    if (parsedStreaming) {
        return parsedStreaming;
    }
    const legacy = parseDiscordPreviewStreamMode(params.streamMode);
    if (legacy) {
        return legacy;
    }
    if (typeof params.streaming === "boolean") {
        return params.streaming ? "partial" : "off";
    }
    // Discord preview streaming edits can hit aggressive rate limits, especially
    // when multiple gateways or multiple bots share the same account/server. Keep
    // the default off unless the operator opts in explicitly.
    return "off";
}
export function resolveSlackStreamingMode(params = {}) {
    const parsedStreaming = parseStreamingMode(params.streaming);
    if (parsedStreaming) {
        return parsedStreaming;
    }
    const legacyStreamMode = parseSlackLegacyDraftStreamMode(params.streamMode);
    if (legacyStreamMode) {
        return mapSlackLegacyDraftStreamModeToStreaming(legacyStreamMode);
    }
    // Legacy boolean `streaming` values map to the unified enum.
    if (typeof params.streaming === "boolean") {
        return params.streaming ? "partial" : "off";
    }
    return "partial";
}
export function resolveSlackNativeStreaming(params = {}) {
    if (typeof params.nativeStreaming === "boolean") {
        return params.nativeStreaming;
    }
    if (typeof params.streaming === "boolean") {
        return params.streaming;
    }
    return true;
}
export function formatSlackStreamModeMigrationMessage(pathPrefix, resolvedStreaming) {
    return `Moved ${pathPrefix}.streamMode → ${pathPrefix}.streaming (${resolvedStreaming}).`;
}
export function formatSlackStreamingBooleanMigrationMessage(pathPrefix, resolvedNativeStreaming) {
    return `Moved ${pathPrefix}.streaming (boolean) → ${pathPrefix}.nativeStreaming (${resolvedNativeStreaming}).`;
}
