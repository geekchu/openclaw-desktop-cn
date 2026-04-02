import { resolveMatrixAuth } from "./matrix/client.js";
import { MatrixAuthedHttpClient } from "./matrix/sdk/http-client.js";
import { isMatrixQualifiedUserId, normalizeMatrixMessagingTarget } from "./matrix/target-ids.js";
const MATRIX_DIRECTORY_TIMEOUT_MS = 10_000;
function normalizeQuery(value) {
    return value?.trim() ?? "";
}
function resolveMatrixDirectoryLimit(limit) {
    return typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.max(1, Math.floor(limit))
        : 20;
}
function createMatrixDirectoryClient(auth) {
    return new MatrixAuthedHttpClient(auth.homeserver, auth.accessToken, auth.ssrfPolicy);
}
async function resolveMatrixDirectoryContext(params) {
    const query = normalizeQuery(params.query);
    if (!query) {
        return null;
    }
    const auth = await resolveMatrixAuth({ cfg: params.cfg, accountId: params.accountId });
    return {
        auth,
        client: createMatrixDirectoryClient(auth),
        query,
        queryLower: query.toLowerCase(),
    };
}
function createGroupDirectoryEntry(params) {
    return {
        kind: "group",
        id: params.id,
        name: params.name,
        handle: params.handle,
    };
}
async function requestMatrixJson(client, params) {
    return (await client.requestJson({
        method: params.method,
        endpoint: params.endpoint,
        body: params.body,
        timeoutMs: MATRIX_DIRECTORY_TIMEOUT_MS,
    }));
}
export async function listMatrixDirectoryPeersLive(params) {
    const query = normalizeQuery(params.query);
    if (!query) {
        return [];
    }
    const directUserId = normalizeMatrixMessagingTarget(query);
    if (directUserId && isMatrixQualifiedUserId(directUserId)) {
        return [{ kind: "user", id: directUserId }];
    }
    const context = await resolveMatrixDirectoryContext({
        ...params,
        query,
    });
    if (!context) {
        return [];
    }
    const res = await requestMatrixJson(context.client, {
        method: "POST",
        endpoint: "/_matrix/client/v3/user_directory/search",
        body: {
            search_term: context.query,
            limit: resolveMatrixDirectoryLimit(params.limit),
        },
    });
    const results = res.results ?? [];
    return results
        .map((entry) => {
        const userId = entry.user_id?.trim();
        if (!userId) {
            return null;
        }
        return {
            kind: "user",
            id: userId,
            name: entry.display_name?.trim() || undefined,
            handle: entry.display_name ? `@${entry.display_name.trim()}` : undefined,
            raw: entry,
        };
    })
        .filter(Boolean);
}
async function resolveMatrixRoomAlias(client, alias) {
    try {
        const res = await requestMatrixJson(client, {
            method: "GET",
            endpoint: `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
        });
        return res.room_id?.trim() || null;
    }
    catch {
        return null;
    }
}
async function fetchMatrixRoomName(client, roomId) {
    try {
        const res = await requestMatrixJson(client, {
            method: "GET",
            endpoint: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
        });
        return res.name?.trim() || null;
    }
    catch {
        return null;
    }
}
export async function listMatrixDirectoryGroupsLive(params) {
    const query = normalizeQuery(params.query);
    if (!query) {
        return [];
    }
    const directTarget = normalizeMatrixMessagingTarget(query);
    if (directTarget?.startsWith("!")) {
        return [createGroupDirectoryEntry({ id: directTarget, name: directTarget })];
    }
    const context = await resolveMatrixDirectoryContext({
        ...params,
        query,
    });
    if (!context) {
        return [];
    }
    const { client, queryLower } = context;
    const limit = resolveMatrixDirectoryLimit(params.limit);
    if (directTarget?.startsWith("#")) {
        const roomId = await resolveMatrixRoomAlias(client, directTarget);
        if (!roomId) {
            return [];
        }
        return [createGroupDirectoryEntry({ id: roomId, name: directTarget, handle: directTarget })];
    }
    const joined = await requestMatrixJson(client, {
        method: "GET",
        endpoint: "/_matrix/client/v3/joined_rooms",
    });
    const rooms = (joined.joined_rooms ?? []).map((roomId) => roomId.trim()).filter(Boolean);
    const results = [];
    for (const roomId of rooms) {
        const name = await fetchMatrixRoomName(client, roomId);
        if (!name || !name.toLowerCase().includes(queryLower)) {
            continue;
        }
        results.push({
            kind: "group",
            id: roomId,
            name,
            handle: `#${name}`,
        });
        if (results.length >= limit) {
            break;
        }
    }
    return results;
}
