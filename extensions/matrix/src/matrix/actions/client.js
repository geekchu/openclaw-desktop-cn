import { withResolvedRuntimeMatrixClient } from "../client-bootstrap.js";
import { resolveMatrixRoomId } from "../send.js";
export async function withResolvedActionClient(opts, run, mode = "stop") {
    return await withResolvedRuntimeMatrixClient(opts, run, mode);
}
export async function withStartedActionClient(opts, run) {
    return await withResolvedActionClient({ ...opts, readiness: "started" }, run, "persist");
}
export async function withResolvedRoomAction(roomId, opts, run) {
    return await withResolvedActionClient(opts, async (client) => {
        const resolvedRoom = await resolveMatrixRoomId(client, roomId);
        return await run(client, resolvedRoom);
    });
}
