/** Read loose boolean params from tool input that may arrive as booleans or "true"/"false" strings. */
export function readBooleanParam(params, key) {
    const raw = params[key];
    if (typeof raw === "boolean") {
        return raw;
    }
    if (typeof raw === "string") {
        const trimmed = raw.trim().toLowerCase();
        if (trimmed === "true") {
            return true;
        }
        if (trimmed === "false") {
            return false;
        }
    }
    return undefined;
}
