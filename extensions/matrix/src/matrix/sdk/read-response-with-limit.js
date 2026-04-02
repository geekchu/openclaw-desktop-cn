import { readResponseWithLimit as readSharedResponseWithLimit } from "openclaw/plugin-sdk/media-runtime";
export async function readResponseWithLimit(res, maxBytes, opts) {
    return await readSharedResponseWithLimit(res, maxBytes, {
        ...opts,
        onIdleTimeout: opts?.onIdleTimeout ??
            (({ chunkTimeoutMs }) => new Error(`Matrix media download stalled: no data received for ${chunkTimeoutMs}ms`)),
    });
}
