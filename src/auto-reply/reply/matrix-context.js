function normalizeMatrixTarget(value) {
    return typeof value === "string" ? value.trim() : "";
}
function resolveMatrixRoomIdFromTarget(raw) {
    let target = normalizeMatrixTarget(raw);
    if (!target) {
        return undefined;
    }
    if (target.toLowerCase().startsWith("matrix:")) {
        target = target.slice("matrix:".length).trim();
    }
    if (/^(room|channel):/i.test(target)) {
        const roomId = target.replace(/^(room|channel):/i, "").trim();
        return roomId || undefined;
    }
    if (target.startsWith("!") || target.startsWith("#")) {
        return target;
    }
    return undefined;
}
export function resolveMatrixParentConversationId(params) {
    const targets = [params.ctx.OriginatingTo, params.command.to, params.ctx.To];
    for (const candidate of targets) {
        const roomId = resolveMatrixRoomIdFromTarget(candidate ?? "");
        if (roomId) {
            return roomId;
        }
    }
    return undefined;
}
export function resolveMatrixConversationId(params) {
    const threadId = params.ctx.MessageThreadId != null ? String(params.ctx.MessageThreadId).trim() : "";
    if (threadId) {
        return threadId;
    }
    return resolveMatrixParentConversationId(params);
}
