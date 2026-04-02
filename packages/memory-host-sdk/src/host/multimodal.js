const MEMORY_MULTIMODAL_SPECS = {
    image: {
        labelPrefix: "Image file",
        extensions: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"],
    },
    audio: {
        labelPrefix: "Audio file",
        extensions: [".mp3", ".wav", ".ogg", ".opus", ".m4a", ".aac", ".flac"],
    },
};
export const MEMORY_MULTIMODAL_MODALITIES = Object.keys(MEMORY_MULTIMODAL_SPECS);
export const DEFAULT_MEMORY_MULTIMODAL_MAX_FILE_BYTES = 10 * 1024 * 1024;
export function normalizeMemoryMultimodalModalities(raw) {
    if (raw === undefined || raw.includes("all")) {
        return [...MEMORY_MULTIMODAL_MODALITIES];
    }
    const normalized = new Set();
    for (const value of raw) {
        if (value === "image" || value === "audio") {
            normalized.add(value);
        }
    }
    return Array.from(normalized);
}
export function normalizeMemoryMultimodalSettings(raw) {
    const enabled = raw.enabled === true;
    const maxFileBytes = typeof raw.maxFileBytes === "number" && Number.isFinite(raw.maxFileBytes)
        ? Math.max(1, Math.floor(raw.maxFileBytes))
        : DEFAULT_MEMORY_MULTIMODAL_MAX_FILE_BYTES;
    return {
        enabled,
        modalities: enabled ? normalizeMemoryMultimodalModalities(raw.modalities) : [],
        maxFileBytes,
    };
}
export function isMemoryMultimodalEnabled(settings) {
    return settings.enabled && settings.modalities.length > 0;
}
export function getMemoryMultimodalExtensions(modality) {
    return MEMORY_MULTIMODAL_SPECS[modality].extensions;
}
export function buildMemoryMultimodalLabel(modality, normalizedPath) {
    return `${MEMORY_MULTIMODAL_SPECS[modality].labelPrefix}: ${normalizedPath}`;
}
export function buildCaseInsensitiveExtensionGlob(extension) {
    const normalized = extension.trim().replace(/^\./, "").toLowerCase();
    if (!normalized) {
        return "*";
    }
    const parts = Array.from(normalized, (char) => `[${char.toLowerCase()}${char.toUpperCase()}]`);
    return `*.${parts.join("")}`;
}
export function classifyMemoryMultimodalPath(filePath, settings) {
    if (!isMemoryMultimodalEnabled(settings)) {
        return null;
    }
    const lower = filePath.trim().toLowerCase();
    for (const modality of settings.modalities) {
        for (const extension of getMemoryMultimodalExtensions(modality)) {
            if (lower.endsWith(extension)) {
                return modality;
            }
        }
    }
    return null;
}
export function normalizeGeminiEmbeddingModelForMemory(model) {
    const trimmed = model.trim();
    if (!trimmed) {
        return "";
    }
    return trimmed.replace(/^models\//, "").replace(/^(gemini|google)\//, "");
}
export function supportsMemoryMultimodalEmbeddings(params) {
    if (params.provider !== "gemini") {
        return false;
    }
    return normalizeGeminiEmbeddingModelForMemory(params.model) === "gemini-embedding-2-preview";
}
