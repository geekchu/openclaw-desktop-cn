import { findNormalizedProviderValue } from "../model-selection.js";
import { extractAssistantText } from "../pi-embedded-utils.js";
import { coerceToolModelConfig } from "./model-config.helpers.js";
export function decodeDataUrl(dataUrl) {
    const trimmed = dataUrl.trim();
    const match = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(trimmed);
    if (!match) {
        throw new Error("Invalid data URL (expected base64 data: URL).");
    }
    const mimeType = (match[1] ?? "").trim().toLowerCase();
    if (!mimeType.startsWith("image/")) {
        throw new Error(`Unsupported data URL type: ${mimeType || "unknown"}`);
    }
    const b64 = (match[2] ?? "").trim();
    const buffer = Buffer.from(b64, "base64");
    if (buffer.length === 0) {
        throw new Error("Invalid data URL: empty payload.");
    }
    return { buffer, mimeType, kind: "image" };
}
export function coerceImageAssistantText(params) {
    const stop = params.message.stopReason;
    const errorMessage = params.message.errorMessage?.trim();
    if (stop === "error" || stop === "aborted") {
        throw new Error(errorMessage
            ? `Image model failed (${params.provider}/${params.model}): ${errorMessage}`
            : `Image model failed (${params.provider}/${params.model})`);
    }
    if (errorMessage) {
        throw new Error(`Image model failed (${params.provider}/${params.model}): ${errorMessage}`);
    }
    const text = extractAssistantText(params.message);
    if (text.trim()) {
        return text.trim();
    }
    throw new Error(`Image model returned no text (${params.provider}/${params.model}).`);
}
export function coerceImageModelConfig(cfg) {
    return coerceToolModelConfig(cfg?.agents?.defaults?.imageModel);
}
export function resolveProviderVisionModelFromConfig(params) {
    const providerCfg = findNormalizedProviderValue(params.cfg?.models?.providers, params.provider);
    const models = providerCfg?.models ?? [];
    const picked = models.find((m) => Boolean((m?.id ?? "").trim()) && m.input?.includes("image"));
    const id = (picked?.id ?? "").trim();
    return id ? `${params.provider}/${id}` : null;
}
