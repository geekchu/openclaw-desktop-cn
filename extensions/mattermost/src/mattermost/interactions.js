import { createHmac, timingSafeEqual } from "node:crypto";
import { getMattermostRuntime } from "../runtime.js";
import { updateMattermostPost } from "./client.js";
import { isTrustedProxyAddress, resolveClientIp } from "./runtime-api.js";
const INTERACTION_MAX_BODY_BYTES = 64 * 1024;
const INTERACTION_BODY_TIMEOUT_MS = 10_000;
const SIGNED_CHANNEL_ID_CONTEXT_KEY = "__openclaw_channel_id";
// ── Callback URL registry ──────────────────────────────────────────────
const callbackUrls = new Map();
export function setInteractionCallbackUrl(accountId, url) {
    callbackUrls.set(accountId, url);
}
export function getInteractionCallbackUrl(accountId) {
    return callbackUrls.get(accountId);
}
export function resolveInteractionCallbackPath(accountId) {
    return `/mattermost/interactions/${accountId}`;
}
function isWildcardBindHost(rawHost) {
    const trimmed = rawHost.trim();
    if (!trimmed)
        return false;
    const host = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
    return host === "0.0.0.0" || host === "::" || host === "0:0:0:0:0:0:0:0" || host === "::0";
}
function normalizeCallbackBaseUrl(baseUrl) {
    return baseUrl.trim().replace(/\/+$/, "");
}
function headerValue(value) {
    if (Array.isArray(value)) {
        return value[0]?.trim() || undefined;
    }
    return value?.trim() || undefined;
}
function isAllowedInteractionSource(params) {
    const { allowedSourceIps } = params;
    if (!allowedSourceIps?.length) {
        return true;
    }
    const clientIp = resolveClientIp({
        remoteAddr: params.req.socket?.remoteAddress,
        forwardedFor: headerValue(params.req.headers["x-forwarded-for"]),
        realIp: headerValue(params.req.headers["x-real-ip"]),
        trustedProxies: params.trustedProxies,
        allowRealIpFallback: params.allowRealIpFallback,
    });
    return isTrustedProxyAddress(clientIp, allowedSourceIps);
}
/**
 * Resolve the interaction callback URL for an account.
 * Falls back to computing it from interactions.callbackBaseUrl or gateway host config.
 */
export function computeInteractionCallbackUrl(accountId, cfg) {
    const path = resolveInteractionCallbackPath(accountId);
    // Prefer merged per-account config when available, but keep the top-level path for
    // callers/tests that still pass the root Mattermost config shape directly.
    const callbackBaseUrl = cfg?.interactions?.callbackBaseUrl?.trim() ??
        cfg?.channels?.mattermost?.interactions?.callbackBaseUrl?.trim();
    if (callbackBaseUrl) {
        return `${normalizeCallbackBaseUrl(callbackBaseUrl)}${path}`;
    }
    const port = typeof cfg?.gateway?.port === "number" ? cfg.gateway.port : 18789;
    let host = cfg?.gateway?.customBindHost && !isWildcardBindHost(cfg.gateway.customBindHost)
        ? cfg.gateway.customBindHost.trim()
        : "localhost";
    // Bracket IPv6 literals so the URL is valid: http://[::1]:18789/...
    if (host.includes(":") && !(host.startsWith("[") && host.endsWith("]"))) {
        host = `[${host}]`;
    }
    return `http://${host}:${port}${path}`;
}
/**
 * Resolve the interaction callback URL for an account.
 * Prefers the in-memory registered URL (set by the gateway monitor) so callers outside the
 * monitor lifecycle can reuse the runtime-validated callback destination.
 */
export function resolveInteractionCallbackUrl(accountId, cfg) {
    const cached = callbackUrls.get(accountId);
    if (cached) {
        return cached;
    }
    return computeInteractionCallbackUrl(accountId, cfg);
}
// ── HMAC token management ──────────────────────────────────────────────
// Secret is derived from the bot token so it's stable across CLI and gateway processes.
const interactionSecrets = new Map();
let defaultInteractionSecret;
function deriveInteractionSecret(botToken) {
    return createHmac("sha256", "openclaw-mattermost-interactions").update(botToken).digest("hex");
}
export function setInteractionSecret(accountIdOrBotToken, botToken) {
    if (typeof botToken === "string") {
        interactionSecrets.set(accountIdOrBotToken, deriveInteractionSecret(botToken));
        return;
    }
    // Backward-compatible fallback for call sites/tests that only pass botToken.
    defaultInteractionSecret = deriveInteractionSecret(accountIdOrBotToken);
}
export function getInteractionSecret(accountId) {
    const scoped = accountId ? interactionSecrets.get(accountId) : undefined;
    if (scoped) {
        return scoped;
    }
    if (defaultInteractionSecret) {
        return defaultInteractionSecret;
    }
    // Fallback for single-account runtimes that only registered scoped secrets.
    if (interactionSecrets.size === 1) {
        const first = interactionSecrets.values().next().value;
        if (typeof first === "string") {
            return first;
        }
    }
    throw new Error("Interaction secret not initialized — call setInteractionSecret(accountId, botToken) first");
}
function canonicalizeInteractionContext(value) {
    if (Array.isArray(value)) {
        return value.map((item) => canonicalizeInteractionContext(item));
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entryValue]) => [key, canonicalizeInteractionContext(entryValue)]);
        return Object.fromEntries(entries);
    }
    return value;
}
export function generateInteractionToken(context, accountId) {
    const secret = getInteractionSecret(accountId);
    const payload = JSON.stringify(canonicalizeInteractionContext(context));
    return createHmac("sha256", secret).update(payload).digest("hex");
}
export function verifyInteractionToken(context, token, accountId) {
    const expected = generateInteractionToken(context, accountId);
    if (expected.length !== token.length) {
        return false;
    }
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
/**
 * Build Mattermost `props.attachments` with interactive buttons.
 *
 * Each button includes an HMAC token in its integration context so the
 * callback handler can verify the request originated from a legitimate
 * button click (Mattermost's recommended security pattern).
 */
/**
 * Sanitize a button ID so Mattermost's action router can match it.
 * Mattermost uses the action ID in the URL path `/api/v4/posts/{id}/actions/{actionId}`
 * and IDs containing hyphens or underscores break the server-side routing.
 * See: https://github.com/mattermost/mattermost/issues/25747
 */
function sanitizeActionId(id) {
    return id.replace(/[-_]/g, "");
}
export function buildButtonAttachments(params) {
    const actions = params.buttons.map((btn) => {
        const safeId = sanitizeActionId(btn.id);
        const context = {
            action_id: safeId,
            ...btn.context,
        };
        const token = generateInteractionToken(context, params.accountId);
        return {
            id: safeId,
            type: "button",
            name: btn.name,
            style: btn.style,
            integration: {
                url: params.callbackUrl,
                context: {
                    ...context,
                    _token: token,
                },
            },
        };
    });
    return [
        {
            text: params.text ?? "",
            actions,
        },
    ];
}
export function buildButtonProps(params) {
    const rawButtons = params.buttons.flatMap((item) => Array.isArray(item) ? item : [item]);
    const buttons = rawButtons
        .map((btn) => ({
        id: String(btn.id ?? btn.callback_data ?? "").trim(),
        name: String(btn.text ?? btn.name ?? btn.label ?? "").trim(),
        style: btn.style ?? "default",
        context: typeof btn.context === "object" && btn.context !== null
            ? {
                ...btn.context,
                [SIGNED_CHANNEL_ID_CONTEXT_KEY]: params.channelId,
            }
            : { [SIGNED_CHANNEL_ID_CONTEXT_KEY]: params.channelId },
    }))
        .filter((btn) => btn.id && btn.name);
    if (buttons.length === 0) {
        return undefined;
    }
    return {
        attachments: buildButtonAttachments({
            callbackUrl: params.callbackUrl,
            accountId: params.accountId,
            buttons,
            text: params.text,
        }),
    };
}
// ── Request body reader ────────────────────────────────────────────────
function readInteractionBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        const timer = setTimeout(() => {
            req.destroy();
            reject(new Error("Request body read timeout"));
        }, INTERACTION_BODY_TIMEOUT_MS);
        req.on("data", (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > INTERACTION_MAX_BODY_BYTES) {
                req.destroy();
                clearTimeout(timer);
                reject(new Error("Request body too large"));
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            clearTimeout(timer);
            resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
// ── HTTP handler ───────────────────────────────────────────────────────
export function createMattermostInteractionHandler(params) {
    const { client, accountId, log } = params;
    const core = getMattermostRuntime();
    return async (req, res) => {
        // Only accept POST
        if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Allow", "POST");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
        }
        if (!isAllowedInteractionSource({
            req,
            allowedSourceIps: params.allowedSourceIps,
            trustedProxies: params.trustedProxies,
            allowRealIpFallback: params.allowRealIpFallback,
        })) {
            log?.(`mattermost interaction: rejected callback source remote=${req.socket?.remoteAddress ?? "?"}`);
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Forbidden origin" }));
            return;
        }
        let payload;
        try {
            const raw = await readInteractionBody(req);
            payload = JSON.parse(raw);
        }
        catch (err) {
            log?.(`mattermost interaction: failed to parse body: ${String(err)}`);
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request body" }));
            return;
        }
        const context = payload.context;
        if (!context) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing context" }));
            return;
        }
        // Verify HMAC token
        const token = context._token;
        if (typeof token !== "string") {
            log?.("mattermost interaction: missing _token in context");
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing token" }));
            return;
        }
        // Strip _token before verification (it wasn't in the original context)
        const { _token, ...contextWithoutToken } = context;
        if (!verifyInteractionToken(contextWithoutToken, token, accountId)) {
            log?.("mattermost interaction: invalid _token");
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid token" }));
            return;
        }
        const actionId = context.action_id;
        if (typeof actionId !== "string") {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Missing action_id in context" }));
            return;
        }
        const signedChannelId = typeof contextWithoutToken[SIGNED_CHANNEL_ID_CONTEXT_KEY] === "string"
            ? contextWithoutToken[SIGNED_CHANNEL_ID_CONTEXT_KEY].trim()
            : "";
        if (signedChannelId && signedChannelId !== payload.channel_id) {
            log?.(`mattermost interaction: signed channel mismatch payload=${payload.channel_id} signed=${signedChannelId}`);
            res.statusCode = 403;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Channel mismatch" }));
            return;
        }
        const userName = payload.user_name ?? payload.user_id;
        let originalMessage = "";
        let originalPost = null;
        let clickedButtonName = null;
        try {
            originalPost = await client.request(`/posts/${payload.post_id}`);
            const postChannelId = originalPost.channel_id?.trim();
            if (!postChannelId || postChannelId !== payload.channel_id) {
                log?.(`mattermost interaction: post channel mismatch payload=${payload.channel_id} post=${postChannelId ?? "<missing>"}`);
                res.statusCode = 403;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Post/channel mismatch" }));
                return;
            }
            originalMessage = originalPost.message ?? "";
            // Ensure the callback can only target an action that exists on the original post.
            const postAttachments = Array.isArray(originalPost?.props?.attachments)
                ? originalPost.props.attachments
                : [];
            for (const att of postAttachments) {
                const match = att.actions?.find((a) => a.id === actionId);
                if (match?.name) {
                    clickedButtonName = match.name;
                    break;
                }
            }
            if (clickedButtonName === null) {
                log?.(`mattermost interaction: action ${actionId} not found in post ${payload.post_id}`);
                res.statusCode = 403;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Unknown action" }));
                return;
            }
        }
        catch (err) {
            log?.(`mattermost interaction: failed to validate post ${payload.post_id}: ${String(err)}`);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to validate interaction" }));
            return;
        }
        if (!originalPost) {
            log?.(`mattermost interaction: missing fetched post ${payload.post_id}`);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Failed to load interaction post" }));
            return;
        }
        log?.(`mattermost interaction: action=${actionId} user=${payload.user_name ?? payload.user_id} ` +
            `post=${payload.post_id} channel=${payload.channel_id}`);
        if (params.authorizeButtonClick) {
            try {
                const authorization = await params.authorizeButtonClick({
                    payload,
                    post: originalPost,
                });
                if (!authorization.ok) {
                    res.statusCode = authorization.statusCode ?? 200;
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(authorization.response ?? {
                        ephemeral_text: "You are not allowed to use this action here.",
                    }));
                    return;
                }
            }
            catch (err) {
                log?.(`mattermost interaction: authorization failed: ${String(err)}`);
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Interaction authorization failed" }));
                return;
            }
        }
        if (params.handleInteraction) {
            try {
                const response = await params.handleInteraction({
                    payload,
                    userName,
                    actionId,
                    actionName: clickedButtonName,
                    originalMessage,
                    context: contextWithoutToken,
                    post: originalPost,
                });
                if (response !== null) {
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(response));
                    return;
                }
            }
            catch (err) {
                log?.(`mattermost interaction: custom handler failed: ${String(err)}`);
                res.statusCode = 500;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Interaction handler failed" }));
                return;
            }
        }
        // Dispatch as system event so the agent can handle it.
        // Wrapped in try/catch — the post update below must still run even if
        // system event dispatch fails (e.g. missing sessionKey or channel lookup).
        try {
            const eventLabel = `Mattermost button click: action="${actionId}" ` +
                `by ${payload.user_name ?? payload.user_id} ` +
                `in channel ${payload.channel_id}`;
            const sessionKey = params.resolveSessionKey
                ? await params.resolveSessionKey({
                    channelId: payload.channel_id,
                    userId: payload.user_id,
                    post: originalPost,
                })
                : `agent:main:mattermost:${accountId}:${payload.channel_id}`;
            core.system.enqueueSystemEvent(eventLabel, {
                sessionKey,
                contextKey: `mattermost:interaction:${payload.post_id}:${actionId}`,
            });
        }
        catch (err) {
            log?.(`mattermost interaction: system event dispatch failed: ${String(err)}`);
        }
        // Update the post via API to replace buttons with a completion indicator.
        try {
            await updateMattermostPost(client, payload.post_id, {
                message: originalMessage,
                props: {
                    attachments: [
                        {
                            text: `✓ **${clickedButtonName}** selected by @${userName}`,
                        },
                    ],
                },
            });
        }
        catch (err) {
            log?.(`mattermost interaction: failed to update post ${payload.post_id}: ${String(err)}`);
        }
        // Respond with empty JSON — the post update is handled above
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end("{}");
        // Dispatch a synthetic inbound message so the agent responds to the button click.
        if (params.dispatchButtonClick) {
            try {
                await params.dispatchButtonClick({
                    channelId: payload.channel_id,
                    userId: payload.user_id,
                    userName,
                    actionId,
                    actionName: clickedButtonName,
                    postId: payload.post_id,
                    post: originalPost,
                });
            }
            catch (err) {
                log?.(`mattermost interaction: dispatchButtonClick failed: ${String(err)}`);
            }
        }
    };
}
