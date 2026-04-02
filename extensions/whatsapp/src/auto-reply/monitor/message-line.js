import { resolveMessagePrefix } from "openclaw/plugin-sdk/agent-runtime";
import { formatInboundEnvelope, } from "openclaw/plugin-sdk/channel-inbound";
import { getPrimaryIdentityId, getReplyContext, getSenderIdentity } from "../../identity.js";
export function formatReplyContext(msg) {
    const replyTo = getReplyContext(msg);
    if (!replyTo?.body) {
        return null;
    }
    const sender = replyTo.sender?.label ?? replyTo.sender?.e164 ?? "unknown sender";
    const idPart = replyTo.id ? ` id:${replyTo.id}` : "";
    return `[Replying to ${sender}${idPart}]\n${replyTo.body}\n[/Replying]`;
}
export function buildInboundLine(params) {
    const { cfg, msg, agentId, previousTimestamp, envelope } = params;
    // WhatsApp inbound prefix: channels.whatsapp.messagePrefix > legacy messages.messagePrefix > identity/defaults
    const messagePrefix = resolveMessagePrefix(cfg, agentId, {
        configured: cfg.channels?.whatsapp?.messagePrefix,
        hasAllowFrom: (cfg.channels?.whatsapp?.allowFrom?.length ?? 0) > 0,
    });
    const prefixStr = messagePrefix ? `${messagePrefix} ` : "";
    const replyContext = formatReplyContext(msg);
    const baseLine = `${prefixStr}${msg.body}${replyContext ? `\n\n${replyContext}` : ""}`;
    const sender = getSenderIdentity(msg);
    // Wrap with standardized envelope for the agent.
    return formatInboundEnvelope({
        channel: "WhatsApp",
        from: msg.chatType === "group" ? msg.from : msg.from?.replace(/^whatsapp:/, ""),
        timestamp: msg.timestamp,
        body: baseLine,
        chatType: msg.chatType,
        sender: {
            name: sender.name ?? undefined,
            e164: sender.e164 ?? undefined,
            id: getPrimaryIdentityId(sender) ?? undefined,
        },
        previousTimestamp,
        envelope,
        fromMe: msg.fromMe,
    });
}
