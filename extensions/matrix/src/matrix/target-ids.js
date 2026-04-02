const MATRIX_PREFIX = "matrix:";
const ROOM_PREFIX = "room:";
const CHANNEL_PREFIX = "channel:";
const USER_PREFIX = "user:";
function stripKnownPrefixes(raw, prefixes) {
    let normalized = raw.trim();
    while (normalized) {
        const lowered = normalized.toLowerCase();
        const matched = prefixes.find((prefix) => lowered.startsWith(prefix));
        if (!matched) {
            return normalized;
        }
        normalized = normalized.slice(matched.length).trim();
    }
    return normalized;
}
export function resolveMatrixTargetIdentity(raw) {
    const normalized = stripKnownPrefixes(raw, [MATRIX_PREFIX]);
    if (!normalized) {
        return null;
    }
    const lowered = normalized.toLowerCase();
    if (lowered.startsWith(USER_PREFIX)) {
        const id = normalized.slice(USER_PREFIX.length).trim();
        return id ? { kind: "user", id } : null;
    }
    if (lowered.startsWith(ROOM_PREFIX)) {
        const id = normalized.slice(ROOM_PREFIX.length).trim();
        return id ? { kind: "room", id } : null;
    }
    if (lowered.startsWith(CHANNEL_PREFIX)) {
        const id = normalized.slice(CHANNEL_PREFIX.length).trim();
        return id ? { kind: "room", id } : null;
    }
    if (isMatrixQualifiedUserId(normalized)) {
        return { kind: "user", id: normalized };
    }
    return { kind: "room", id: normalized };
}
export function isMatrixQualifiedUserId(raw) {
    const trimmed = raw.trim();
    return trimmed.startsWith("@") && trimmed.includes(":");
}
export function normalizeMatrixResolvableTarget(raw) {
    return stripKnownPrefixes(raw, [MATRIX_PREFIX, ROOM_PREFIX, CHANNEL_PREFIX]);
}
export function normalizeMatrixMessagingTarget(raw) {
    const normalized = stripKnownPrefixes(raw, [
        MATRIX_PREFIX,
        ROOM_PREFIX,
        CHANNEL_PREFIX,
        USER_PREFIX,
    ]);
    return normalized || undefined;
}
export function normalizeMatrixDirectoryUserId(raw) {
    const normalized = stripKnownPrefixes(raw, [MATRIX_PREFIX, USER_PREFIX]);
    if (!normalized || normalized === "*") {
        return undefined;
    }
    return isMatrixQualifiedUserId(normalized) ? `user:${normalized}` : normalized;
}
export function normalizeMatrixDirectoryGroupId(raw) {
    const normalized = stripKnownPrefixes(raw, [MATRIX_PREFIX]);
    if (!normalized || normalized === "*") {
        return undefined;
    }
    const lowered = normalized.toLowerCase();
    if (lowered.startsWith(ROOM_PREFIX) || lowered.startsWith(CHANNEL_PREFIX)) {
        return normalized;
    }
    if (normalized.startsWith("!")) {
        return `room:${normalized}`;
    }
    return normalized;
}
export function resolveMatrixDirectUserId(params) {
    if (params.chatType !== "direct") {
        return undefined;
    }
    const roomId = normalizeMatrixResolvableTarget(params.to ?? "");
    if (!roomId.startsWith("!")) {
        return undefined;
    }
    const userId = stripKnownPrefixes(params.from ?? "", [MATRIX_PREFIX, USER_PREFIX]);
    return isMatrixQualifiedUserId(userId) ? userId : undefined;
}
