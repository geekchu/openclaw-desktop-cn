function trimMaybeString(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
export function normalizeJoinedMatrixMembers(joinedMembers) {
    if (!Array.isArray(joinedMembers)) {
        return [];
    }
    return joinedMembers
        .map((entry) => trimMaybeString(entry))
        .filter((entry) => Boolean(entry));
}
export function isStrictDirectMembership(params) {
    const selfUserId = trimMaybeString(params.selfUserId);
    const remoteUserId = trimMaybeString(params.remoteUserId);
    const joinedMembers = params.joinedMembers ?? [];
    return Boolean(selfUserId &&
        remoteUserId &&
        joinedMembers.length === 2 &&
        joinedMembers.includes(selfUserId) &&
        joinedMembers.includes(remoteUserId));
}
export async function readJoinedMatrixMembers(client, roomId) {
    try {
        return normalizeJoinedMatrixMembers(await client.getJoinedRoomMembers(roomId));
    }
    catch {
        return null;
    }
}
export async function hasDirectMatrixMemberFlag(client, roomId, userId) {
    const normalizedUserId = trimMaybeString(userId);
    if (!normalizedUserId) {
        return false;
    }
    try {
        const state = await client.getRoomStateEvent(roomId, "m.room.member", normalizedUserId);
        return state?.is_direct === true;
    }
    catch {
        return false;
    }
}
export async function inspectMatrixDirectRoomEvidence(params) {
    const selfUserId = params.selfUserId !== undefined
        ? trimMaybeString(params.selfUserId)
        : trimMaybeString(await params.client.getUserId().catch(() => null));
    const joinedMembers = await readJoinedMatrixMembers(params.client, params.roomId);
    const strict = isStrictDirectMembership({
        selfUserId,
        remoteUserId: params.remoteUserId,
        joinedMembers,
    });
    if (!strict) {
        return {
            joinedMembers,
            strict: false,
            viaMemberState: false,
        };
    }
    return {
        joinedMembers,
        strict,
        viaMemberState: (await hasDirectMatrixMemberFlag(params.client, params.roomId, params.remoteUserId)) ||
            (await hasDirectMatrixMemberFlag(params.client, params.roomId, selfUserId)),
    };
}
export async function isStrictDirectRoom(params) {
    return (await inspectMatrixDirectRoomEvidence({
        client: params.client,
        roomId: params.roomId,
        remoteUserId: params.remoteUserId,
        selfUserId: params.selfUserId,
    })).strict;
}
