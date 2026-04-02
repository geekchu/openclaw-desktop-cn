export const TTS_AUTO_MODES = new Set(["off", "always", "inbound", "tagged"]);
export function normalizeTtsAutoMode(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (TTS_AUTO_MODES.has(normalized)) {
        return normalized;
    }
    return undefined;
}
