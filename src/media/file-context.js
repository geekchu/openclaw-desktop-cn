const XML_ESCAPE_MAP = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
};
function xmlEscapeAttr(value) {
    return value.replace(/[<>&"']/g, (char) => XML_ESCAPE_MAP[char] ?? char);
}
function escapeFileBlockContent(value) {
    return value.replace(/<\s*\/\s*file\s*>/gi, "&lt;/file&gt;").replace(/<\s*file\b/gi, "&lt;file");
}
function sanitizeFileName(value, fallbackName) {
    const normalized = typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").trim() : "";
    return normalized || fallbackName;
}
export function renderFileContextBlock(params) {
    const fallbackName = typeof params.fallbackName === "string" && params.fallbackName.trim().length > 0
        ? params.fallbackName.trim()
        : "attachment";
    const safeName = sanitizeFileName(params.filename, fallbackName);
    const safeContent = escapeFileBlockContent(params.content);
    const attrs = [
        `name="${xmlEscapeAttr(safeName)}"`,
        typeof params.mimeType === "string" && params.mimeType.trim()
            ? `mime="${xmlEscapeAttr(params.mimeType.trim())}"`
            : undefined,
    ]
        .filter(Boolean)
        .join(" ");
    if (params.surroundContentWithNewlines === false) {
        return `<file ${attrs}>${safeContent}</file>`;
    }
    return `<file ${attrs}>\n${safeContent}\n</file>`;
}
