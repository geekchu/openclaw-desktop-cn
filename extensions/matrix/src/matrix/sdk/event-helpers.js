export function matrixEventToRaw(event) {
    const unsigned = (event.getUnsigned?.() ?? {});
    const raw = {
        event_id: event.getId() ?? "",
        sender: event.getSender() ?? "",
        type: event.getType() ?? "",
        origin_server_ts: event.getTs() ?? 0,
        content: (event.getContent?.() ?? {}) || {},
        unsigned,
    };
    const stateKey = resolveMatrixStateKey(event);
    if (typeof stateKey === "string") {
        raw.state_key = stateKey;
    }
    return raw;
}
export function parseMxc(url) {
    const match = /^mxc:\/\/([^/]+)\/(.+)$/.exec(url.trim());
    if (!match) {
        return null;
    }
    return {
        server: match[1],
        mediaId: match[2],
    };
}
export function buildHttpError(statusCode, bodyText) {
    let message = `Matrix HTTP ${statusCode}`;
    if (bodyText.trim()) {
        try {
            const parsed = JSON.parse(bodyText);
            if (typeof parsed.error === "string" && parsed.error.trim()) {
                message = parsed.error.trim();
            }
            else {
                message = bodyText.slice(0, 500);
            }
        }
        catch {
            message = bodyText.slice(0, 500);
        }
    }
    return Object.assign(new Error(message), { statusCode });
}
function resolveMatrixStateKey(event) {
    const direct = event.getStateKey?.();
    if (typeof direct === "string") {
        return direct;
    }
    const wireContent = event.getWireContent?.();
    if (wireContent && typeof wireContent.state_key === "string") {
        return wireContent.state_key;
    }
    const rawEvent = event.event;
    if (rawEvent && typeof rawEvent.state_key === "string") {
        return rawEvent.state_key;
    }
    return undefined;
}
