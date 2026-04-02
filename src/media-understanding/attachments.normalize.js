import { assertNoWindowsNetworkPath, safeFileURLToPath } from "../infra/local-file-access.js";
import { getFileExtension, isAudioFileName, kindFromMime } from "../media/mime.js";
export function normalizeAttachmentPath(raw) {
    const value = raw?.trim();
    if (!value) {
        return undefined;
    }
    if (value.startsWith("file://")) {
        try {
            return safeFileURLToPath(value);
        }
        catch {
            return undefined;
        }
    }
    try {
        assertNoWindowsNetworkPath(value, "Attachment path");
    }
    catch {
        return undefined;
    }
    return value;
}
export function normalizeAttachments(ctx) {
    const pathsFromArray = Array.isArray(ctx.MediaPaths) ? ctx.MediaPaths : undefined;
    const urlsFromArray = Array.isArray(ctx.MediaUrls) ? ctx.MediaUrls : undefined;
    const typesFromArray = Array.isArray(ctx.MediaTypes) ? ctx.MediaTypes : undefined;
    const resolveMime = (count, index) => {
        const typeHint = typesFromArray?.[index];
        const trimmed = typeof typeHint === "string" ? typeHint.trim() : "";
        if (trimmed) {
            return trimmed;
        }
        return count === 1 ? ctx.MediaType : undefined;
    };
    if (pathsFromArray && pathsFromArray.length > 0) {
        const count = pathsFromArray.length;
        const urls = urlsFromArray && urlsFromArray.length > 0 ? urlsFromArray : undefined;
        return pathsFromArray
            .map((value, index) => ({
            path: value?.trim() || undefined,
            url: urls?.[index] ?? ctx.MediaUrl,
            mime: resolveMime(count, index),
            index,
        }))
            .filter((entry) => Boolean(entry.path?.trim() || entry.url?.trim()));
    }
    if (urlsFromArray && urlsFromArray.length > 0) {
        const count = urlsFromArray.length;
        return urlsFromArray
            .map((value, index) => ({
            path: undefined,
            url: value?.trim() || undefined,
            mime: resolveMime(count, index),
            index,
        }))
            .filter((entry) => Boolean(entry.url?.trim()));
    }
    const pathValue = ctx.MediaPath?.trim();
    const url = ctx.MediaUrl?.trim();
    if (!pathValue && !url) {
        return [];
    }
    return [
        {
            path: pathValue || undefined,
            url: url || undefined,
            mime: ctx.MediaType,
            index: 0,
        },
    ];
}
export function resolveAttachmentKind(attachment) {
    const kind = kindFromMime(attachment.mime);
    if (kind === "image" || kind === "audio" || kind === "video") {
        return kind;
    }
    const ext = getFileExtension(attachment.path ?? attachment.url);
    if (!ext) {
        return "unknown";
    }
    if ([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"].includes(ext)) {
        return "video";
    }
    if (isAudioFileName(attachment.path ?? attachment.url)) {
        return "audio";
    }
    if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"].includes(ext)) {
        return "image";
    }
    return "unknown";
}
export function isVideoAttachment(attachment) {
    return resolveAttachmentKind(attachment) === "video";
}
export function isAudioAttachment(attachment) {
    return resolveAttachmentKind(attachment) === "audio";
}
export function isImageAttachment(attachment) {
    return resolveAttachmentKind(attachment) === "image";
}
