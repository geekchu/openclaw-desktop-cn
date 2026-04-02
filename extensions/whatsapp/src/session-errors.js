function safeStringify(value, limit = 800) {
    try {
        const seen = new WeakSet();
        const raw = JSON.stringify(value, (_key, v) => {
            if (typeof v === "bigint") {
                return v.toString();
            }
            if (typeof v === "function") {
                const maybeName = v.name;
                const name = typeof maybeName === "string" && maybeName.length > 0 ? maybeName : "anonymous";
                return `[Function ${name}]`;
            }
            if (typeof v === "object" && v) {
                if (seen.has(v)) {
                    return "[Circular]";
                }
                seen.add(v);
            }
            return v;
        }, 2);
        if (!raw) {
            return String(value);
        }
        return raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
    }
    catch {
        return String(value);
    }
}
function extractBoomDetails(err) {
    if (!err || typeof err !== "object") {
        return null;
    }
    const output = err?.output;
    if (!output || typeof output !== "object") {
        return null;
    }
    const payload = output.payload;
    const statusCode = typeof output.statusCode === "number"
        ? output.statusCode
        : typeof payload?.statusCode === "number"
            ? payload.statusCode
            : undefined;
    const error = typeof payload?.error === "string" ? payload.error : undefined;
    const message = typeof payload?.message === "string" ? payload.message : undefined;
    if (!statusCode && !error && !message) {
        return null;
    }
    return { statusCode, error, message };
}
export function getStatusCode(err) {
    return (err?.output?.statusCode ??
        err?.status ??
        err?.error?.output?.statusCode);
}
export function formatError(err) {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err === "string") {
        return err;
    }
    if (!err || typeof err !== "object") {
        return String(err);
    }
    const boom = extractBoomDetails(err) ??
        extractBoomDetails(err?.error) ??
        extractBoomDetails(err?.lastDisconnect?.error);
    const status = boom?.statusCode ?? getStatusCode(err);
    const code = err?.code;
    const codeText = typeof code === "string" || typeof code === "number" ? String(code) : undefined;
    const messageCandidates = [
        boom?.message,
        typeof err?.message === "string"
            ? err.message
            : undefined,
        typeof err?.error?.message === "string"
            ? err.error?.message
            : undefined,
    ].filter((value) => Boolean(value && value.trim().length > 0));
    const message = messageCandidates[0];
    const pieces = [];
    if (typeof status === "number") {
        pieces.push(`status=${status}`);
    }
    if (boom?.error) {
        pieces.push(boom.error);
    }
    if (message) {
        pieces.push(message);
    }
    if (codeText) {
        pieces.push(`code=${codeText}`);
    }
    if (pieces.length > 0) {
        return pieces.join(" ");
    }
    return safeStringify(err);
}
