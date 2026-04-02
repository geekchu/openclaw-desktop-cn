export const MATRIX_ANNOTATION_RELATION_TYPE = "m.annotation";
export const MATRIX_REACTION_EVENT_TYPE = "m.reaction";
export function normalizeMatrixReactionMessageId(messageId) {
    const normalized = messageId.trim();
    if (!normalized) {
        throw new Error("Matrix reaction requires a messageId");
    }
    return normalized;
}
export function normalizeMatrixReactionEmoji(emoji) {
    const normalized = emoji.trim();
    if (!normalized) {
        throw new Error("Matrix reaction requires an emoji");
    }
    return normalized;
}
export function buildMatrixReactionContent(messageId, emoji) {
    return {
        "m.relates_to": {
            rel_type: MATRIX_ANNOTATION_RELATION_TYPE,
            event_id: normalizeMatrixReactionMessageId(messageId),
            key: normalizeMatrixReactionEmoji(emoji),
        },
    };
}
export function buildMatrixReactionRelationsPath(roomId, messageId) {
    return `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(normalizeMatrixReactionMessageId(messageId))}/${MATRIX_ANNOTATION_RELATION_TYPE}/${MATRIX_REACTION_EVENT_TYPE}`;
}
export function extractMatrixReactionAnnotation(content) {
    if (!content || typeof content !== "object") {
        return undefined;
    }
    const relatesTo = content["m.relates_to"];
    if (!relatesTo || typeof relatesTo !== "object") {
        return undefined;
    }
    if (typeof relatesTo.rel_type === "string" &&
        relatesTo.rel_type !== MATRIX_ANNOTATION_RELATION_TYPE) {
        return undefined;
    }
    const key = typeof relatesTo.key === "string" ? relatesTo.key.trim() : "";
    if (!key) {
        return undefined;
    }
    const eventId = typeof relatesTo.event_id === "string" ? relatesTo.event_id.trim() : "";
    return {
        key,
        eventId: eventId || undefined,
    };
}
export function extractMatrixReactionKey(content) {
    return extractMatrixReactionAnnotation(content)?.key;
}
export function summarizeMatrixReactionEvents(events) {
    const summaries = new Map();
    for (const event of events) {
        const key = extractMatrixReactionKey(event.content);
        if (!key) {
            continue;
        }
        const sender = event.sender?.trim() ?? "";
        const entry = summaries.get(key) ?? { key, count: 0, users: [] };
        entry.count += 1;
        if (sender && !entry.users.includes(sender)) {
            entry.users.push(sender);
        }
        summaries.set(key, entry);
    }
    return Array.from(summaries.values());
}
export function selectOwnMatrixReactionEventIds(events, userId, emoji) {
    const senderId = userId.trim();
    if (!senderId) {
        return [];
    }
    const targetEmoji = emoji?.trim();
    const ids = [];
    for (const event of events) {
        if ((event.sender?.trim() ?? "") !== senderId) {
            continue;
        }
        if (targetEmoji && extractMatrixReactionKey(event.content) !== targetEmoji) {
            continue;
        }
        const eventId = event.event_id?.trim();
        if (eventId) {
            ids.push(eventId);
        }
    }
    return ids;
}
