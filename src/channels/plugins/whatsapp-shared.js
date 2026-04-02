import { resolveOutboundSendDep } from "../../infra/outbound/send-deps.js";
import { createAttachedChannelResultAdapter } from "../../plugin-sdk/channel-send-result.js";
import { escapeRegExp } from "../../utils.js";
export const WHATSAPP_GROUP_INTRO_HINT = "WhatsApp IDs: SenderId is the participant JID (group participant id).";
export function resolveWhatsAppGroupIntroHint() {
    return WHATSAPP_GROUP_INTRO_HINT;
}
export function resolveWhatsAppMentionStripRegexes(ctx) {
    const selfE164 = (ctx.To ?? "").replace(/^whatsapp:/, "");
    if (!selfE164) {
        return [];
    }
    const escaped = escapeRegExp(selfE164);
    return [new RegExp(escaped, "g"), new RegExp(`@${escaped}`, "g")];
}
export function createWhatsAppOutboundBase({ chunker, sendMessageWhatsApp, sendPollWhatsApp, shouldLogVerbose, resolveTarget, normalizeText = (text) => text ?? "", skipEmptyText = false, }) {
    return {
        deliveryMode: "gateway",
        chunker,
        chunkerMode: "text",
        textChunkLimit: 4000,
        pollMaxOptions: 12,
        resolveTarget,
        ...createAttachedChannelResultAdapter({
            channel: "whatsapp",
            sendText: async ({ cfg, to, text, accountId, deps, gifPlayback }) => {
                const normalizedText = normalizeText(text);
                if (skipEmptyText && !normalizedText) {
                    return { messageId: "" };
                }
                const send = resolveOutboundSendDep(deps, "whatsapp") ?? sendMessageWhatsApp;
                return await send(to, normalizedText, {
                    verbose: false,
                    cfg,
                    accountId: accountId ?? undefined,
                    gifPlayback,
                });
            },
            sendMedia: async ({ cfg, to, text, mediaUrl, mediaLocalRoots, accountId, deps, gifPlayback, }) => {
                const send = resolveOutboundSendDep(deps, "whatsapp") ?? sendMessageWhatsApp;
                return await send(to, normalizeText(text), {
                    verbose: false,
                    cfg,
                    mediaUrl,
                    mediaLocalRoots,
                    accountId: accountId ?? undefined,
                    gifPlayback,
                });
            },
            sendPoll: async ({ cfg, to, poll, accountId }) => await sendPollWhatsApp(to, poll, {
                verbose: shouldLogVerbose(),
                accountId: accountId ?? undefined,
                cfg,
            }),
        }),
    };
}
