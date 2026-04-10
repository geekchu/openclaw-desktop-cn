import { jidToE164, normalizeE164 } from "./text-runtime.js";
const WHATSAPP_LID_RE = /@(lid|hosted\.lid)$/i;
export function normalizeDeviceScopedJid(jid) {
    return jid ? jid.replace(/:\d+/, "") : null;
}
function isLidJid(jid) {
    return Boolean(jid && WHATSAPP_LID_RE.test(jid));
}
export function resolveComparableIdentity(identity, authDir) {
    const rawJid = normalizeDeviceScopedJid(identity?.jid);
    const rawLid = normalizeDeviceScopedJid(identity?.lid);
    const lid = rawLid ?? (isLidJid(rawJid) ? rawJid : null);
    const jid = rawJid && !isLidJid(rawJid) ? rawJid : null;
    const e164 = identity?.e164 != null
        ? normalizeE164(identity.e164)
        : ((jid ? jidToE164(jid, authDir ? { authDir } : undefined) : null) ??
            (lid ? jidToE164(lid, authDir ? { authDir } : undefined) : null));
    return {
        ...identity,
        jid,
        lid,
        e164,
    };
}
export function getComparableIdentityValues(identity) {
    const resolved = resolveComparableIdentity(identity);
    return [resolved.e164, resolved.jid, resolved.lid].filter((value) => Boolean(value));
}
export function identitiesOverlap(left, right) {
    const leftValues = new Set(getComparableIdentityValues(left));
    if (leftValues.size === 0) {
        return false;
    }
    return getComparableIdentityValues(right).some((value) => leftValues.has(value));
}
export function getSenderIdentity(msg, authDir) {
    return resolveComparableIdentity(msg.sender ?? {
        jid: msg.senderJid ?? null,
        e164: msg.senderE164 ?? null,
        name: msg.senderName ?? null,
    }, authDir);
}
export function getSelfIdentity(msg, authDir) {
    return resolveComparableIdentity(msg.self ?? {
        jid: msg.selfJid ?? null,
        lid: msg.selfLid ?? null,
        e164: msg.selfE164 ?? null,
    }, authDir);
}
export function getReplyContext(msg, authDir) {
    if (msg.replyTo) {
        return {
            ...msg.replyTo,
            sender: resolveComparableIdentity(msg.replyTo.sender, authDir),
        };
    }
    if (!msg.replyToBody) {
        return null;
    }
    return {
        id: msg.replyToId,
        body: msg.replyToBody,
        sender: resolveComparableIdentity({
            jid: msg.replyToSenderJid ?? null,
            e164: msg.replyToSenderE164 ?? null,
            label: msg.replyToSender ?? null,
        }, authDir),
    };
}
export function getMentionJids(msg) {
    return msg.mentions ?? msg.mentionedJids ?? [];
}
export function getMentionIdentities(msg, authDir) {
    return getMentionJids(msg).map((jid) => resolveComparableIdentity({ jid }, authDir));
}
export function getPrimaryIdentityId(identity) {
    return identity?.e164 || identity?.jid?.trim() || identity?.lid || null;
}
