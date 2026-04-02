import { normalizeProviderId } from "../agents/model-selection.js";
export function normalizeMediaProviderId(id) {
    const normalized = normalizeProviderId(id);
    if (normalized === "gemini") {
        return "google";
    }
    return normalized;
}
