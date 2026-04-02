import { enqueueSystemEvent } from "openclaw/plugin-sdk/channel-runtime";
import { danger } from "openclaw/plugin-sdk/runtime-env";
import { normalizeSlackChannelType } from "../channel-type.js";
import { resolveSlackMessageSubtypeHandler } from "./message-subtype-handlers.js";
import { authorizeAndResolveSlackSystemEventContext } from "./system-event-context.js";
export function registerSlackMessageEvents(params) {
    const { ctx, handleSlackMessage } = params;
    const handleIncomingMessageEvent = async ({ event, body }) => {
        try {
            if (ctx.shouldDropMismatchedSlackEvent(body)) {
                return;
            }
            const message = event;
            const subtypeHandler = resolveSlackMessageSubtypeHandler(message);
            if (subtypeHandler) {
                const channelId = subtypeHandler.resolveChannelId(message);
                const ingressContext = await authorizeAndResolveSlackSystemEventContext({
                    ctx,
                    senderId: subtypeHandler.resolveSenderId(message),
                    channelId,
                    channelType: subtypeHandler.resolveChannelType(message),
                    eventKind: subtypeHandler.eventKind,
                });
                if (!ingressContext) {
                    return;
                }
                enqueueSystemEvent(subtypeHandler.describe(ingressContext.channelLabel), {
                    sessionKey: ingressContext.sessionKey,
                    contextKey: subtypeHandler.contextKey(message),
                });
                return;
            }
            await handleSlackMessage(message, { source: "message" });
        }
        catch (err) {
            ctx.runtime.error?.(danger(`slack handler failed: ${String(err)}`));
        }
    };
    // NOTE: Slack Event Subscriptions use names like "message.channels" and
    // "message.groups" to control *which* message events are delivered, but the
    // actual event payload always arrives with `type: "message"`.  The
    // `channel_type` field ("channel" | "group" | "im" | "mpim") distinguishes
    // the source.  Bolt rejects `app.event("message.channels")` since v4.6
    // because it is a subscription label, not a valid event type.
    ctx.app.event("message", async ({ event, body }) => {
        await handleIncomingMessageEvent({ event, body });
    });
    ctx.app.event("app_mention", async ({ event, body }) => {
        try {
            if (ctx.shouldDropMismatchedSlackEvent(body)) {
                return;
            }
            const mention = event;
            // Skip app_mention for DMs - they're already handled by message.im event
            // This prevents duplicate processing when both message and app_mention fire for DMs
            const channelType = normalizeSlackChannelType(mention.channel_type, mention.channel);
            if (channelType === "im" || channelType === "mpim") {
                return;
            }
            await handleSlackMessage(mention, {
                source: "app_mention",
                wasMentioned: true,
            });
        }
        catch (err) {
            ctx.runtime.error?.(danger(`slack mention handler failed: ${String(err)}`));
        }
    });
}
