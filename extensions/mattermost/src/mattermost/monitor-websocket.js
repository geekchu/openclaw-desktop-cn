import { safeParseJsonWithSchema, safeParseWithSchema } from "openclaw/plugin-sdk/extension-shared";
import { z } from "openclaw/plugin-sdk/zod";
import WebSocket from "ws";
import { MattermostPostSchema } from "./client.js";
import { rawDataToString } from "./monitor-helpers.js";
const MattermostEventPayloadSchema = z.object({
    event: z.string().optional(),
    data: z
        .object({
        post: z.union([z.string(), MattermostPostSchema]).optional(),
        reaction: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
        channel_id: z.string().optional(),
        channel_name: z.string().optional(),
        channel_display_name: z.string().optional(),
        channel_type: z.string().optional(),
        sender_name: z.string().optional(),
        team_id: z.string().optional(),
    })
        .optional(),
    broadcast: z
        .object({
        channel_id: z.string().optional(),
        team_id: z.string().optional(),
        user_id: z.string().optional(),
    })
        .optional(),
});
function parseMattermostEventPayload(raw) {
    return safeParseJsonWithSchema(MattermostEventPayloadSchema, raw);
}
function parseMattermostPost(value) {
    if (typeof value === "string") {
        return safeParseJsonWithSchema(MattermostPostSchema, value);
    }
    return safeParseWithSchema(MattermostPostSchema, value);
}
export class WebSocketClosedBeforeOpenError extends Error {
    code;
    reason;
    constructor(code, reason) {
        super(`websocket closed before open (code ${code})`);
        this.code = code;
        this.reason = reason;
        this.name = "WebSocketClosedBeforeOpenError";
    }
}
export const defaultMattermostWebSocketFactory = (url) => new WebSocket(url);
export function parsePostedPayload(payload) {
    if (payload.event !== "posted") {
        return null;
    }
    const postData = payload.data?.post;
    if (!postData) {
        return null;
    }
    const post = parseMattermostPost(postData);
    if (!post) {
        return null;
    }
    return { payload, post };
}
export function parsePostedEvent(data) {
    const raw = rawDataToString(data);
    const payload = parseMattermostEventPayload(raw);
    if (!payload) {
        return null;
    }
    return parsePostedPayload(payload);
}
export function createMattermostConnectOnce(opts) {
    const webSocketFactory = opts.webSocketFactory ?? defaultMattermostWebSocketFactory;
    return async () => {
        const ws = webSocketFactory(opts.wsUrl);
        const onAbort = () => ws.terminate();
        opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
        try {
            return await new Promise((resolve, reject) => {
                let opened = false;
                let settled = false;
                const resolveOnce = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolve();
                };
                const rejectOnce = (error) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    reject(error);
                };
                ws.on("open", () => {
                    opened = true;
                    opts.statusSink?.({
                        connected: true,
                        lastConnectedAt: Date.now(),
                        lastError: null,
                    });
                    ws.send(JSON.stringify({
                        seq: opts.nextSeq(),
                        action: "authentication_challenge",
                        data: { token: opts.botToken },
                    }));
                });
                ws.on("message", async (data) => {
                    const raw = rawDataToString(data);
                    const payload = parseMattermostEventPayload(raw);
                    if (!payload) {
                        return;
                    }
                    if (payload.event === "reaction_added" || payload.event === "reaction_removed") {
                        if (!opts.onReaction) {
                            return;
                        }
                        try {
                            await opts.onReaction(payload);
                        }
                        catch (err) {
                            opts.runtime.error?.(`mattermost reaction handler failed: ${String(err)}`);
                        }
                        return;
                    }
                    if (payload.event !== "posted") {
                        return;
                    }
                    const parsed = parsePostedPayload(payload);
                    if (!parsed) {
                        return;
                    }
                    try {
                        await opts.onPosted(parsed.post, parsed.payload);
                    }
                    catch (err) {
                        opts.runtime.error?.(`mattermost handler failed: ${String(err)}`);
                    }
                });
                ws.on("close", (code, reason) => {
                    const message = reasonToString(reason);
                    opts.statusSink?.({
                        connected: false,
                        lastDisconnect: {
                            at: Date.now(),
                            status: code,
                            error: message || undefined,
                        },
                    });
                    if (opened) {
                        resolveOnce();
                        return;
                    }
                    rejectOnce(new WebSocketClosedBeforeOpenError(code, message || undefined));
                });
                ws.on("error", (err) => {
                    opts.runtime.error?.(`mattermost websocket error: ${String(err)}`);
                    opts.statusSink?.({
                        lastError: String(err),
                    });
                    try {
                        ws.close();
                    }
                    catch { }
                });
            });
        }
        finally {
            opts.abortSignal?.removeEventListener("abort", onAbort);
        }
    };
}
function reasonToString(reason) {
    if (!reason) {
        return "";
    }
    if (typeof reason === "string") {
        return reason;
    }
    return reason.length > 0 ? reason.toString("utf8") : "";
}
