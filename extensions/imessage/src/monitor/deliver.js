import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolveMarkdownTableMode } from "openclaw/plugin-sdk/config-runtime";
import { deliverTextOrMediaReply, resolveSendableOutboundReplyParts, } from "openclaw/plugin-sdk/reply-payload";
import { chunkTextWithMode, resolveChunkMode } from "openclaw/plugin-sdk/reply-runtime";
import { convertMarkdownTables } from "openclaw/plugin-sdk/text-runtime";
import { sendMessageIMessage } from "../send.js";
import { sanitizeOutboundText } from "./sanitize-outbound.js";
export async function deliverReplies(params) {
    const { replies, target, client, runtime, maxBytes, textLimit, accountId, sentMessageCache } = params;
    const scope = `${accountId ?? ""}:${target}`;
    const cfg = loadConfig();
    const tableMode = resolveMarkdownTableMode({
        cfg,
        channel: "imessage",
        accountId,
    });
    const chunkMode = resolveChunkMode(cfg, "imessage", accountId);
    for (const payload of replies) {
        const rawText = sanitizeOutboundText(payload.text ?? "");
        const reply = resolveSendableOutboundReplyParts(payload, {
            text: convertMarkdownTables(rawText, tableMode),
        });
        if (!reply.hasMedia && reply.hasText) {
            sentMessageCache?.remember(scope, { text: reply.text });
        }
        const delivered = await deliverTextOrMediaReply({
            payload,
            text: reply.text,
            chunkText: (value) => chunkTextWithMode(value, textLimit, chunkMode),
            sendText: async (chunk) => {
                const sent = await sendMessageIMessage(target, chunk, {
                    maxBytes,
                    client,
                    accountId,
                    replyToId: payload.replyToId,
                });
                sentMessageCache?.remember(scope, { text: chunk, messageId: sent.messageId });
            },
            sendMedia: async ({ mediaUrl, caption }) => {
                const sent = await sendMessageIMessage(target, caption ?? "", {
                    mediaUrl,
                    maxBytes,
                    client,
                    accountId,
                    replyToId: payload.replyToId,
                });
                sentMessageCache?.remember(scope, {
                    text: caption || undefined,
                    messageId: sent.messageId,
                });
            },
        });
        if (delivered !== "empty") {
            runtime.log?.(`imessage: delivered reply to ${target}`);
        }
    }
}
