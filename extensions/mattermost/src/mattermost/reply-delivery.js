import { deliverTextOrMediaReply, resolveSendableOutboundReplyParts, } from "openclaw/plugin-sdk/reply-payload";
import { getAgentScopedMediaLocalRoots, } from "./runtime-api.js";
export async function deliverMattermostReplyPayload(params) {
    const reply = resolveSendableOutboundReplyParts(params.payload, {
        text: params.core.channel.text.convertMarkdownTables(params.payload.text ?? "", params.tableMode),
    });
    const mediaLocalRoots = getAgentScopedMediaLocalRoots(params.cfg, params.agentId);
    const chunkMode = params.core.channel.text.resolveChunkMode(params.cfg, "mattermost", params.accountId);
    await deliverTextOrMediaReply({
        payload: params.payload,
        text: reply.text,
        chunkText: (value) => params.core.channel.text.chunkMarkdownTextWithMode(value, params.textLimit, chunkMode),
        sendText: async (chunk) => {
            await params.sendMessage(params.to, chunk, {
                cfg: params.cfg,
                accountId: params.accountId,
                replyToId: params.replyToId,
            });
        },
        sendMedia: async ({ mediaUrl, caption }) => {
            await params.sendMessage(params.to, caption ?? "", {
                cfg: params.cfg,
                accountId: params.accountId,
                mediaUrl,
                mediaLocalRoots,
                replyToId: params.replyToId,
            });
        },
    });
}
