import { resolveMentionGating } from "openclaw/plugin-sdk/channel-inbound";
import { hasControlCommand } from "openclaw/plugin-sdk/command-auth";
import { recordPendingHistoryEntryIfEnabled } from "openclaw/plugin-sdk/reply-history";
import { parseActivationCommand } from "openclaw/plugin-sdk/reply-runtime";
import { normalizeE164 } from "openclaw/plugin-sdk/text-runtime";
import { getPrimaryIdentityId, getReplyContext, getSelfIdentity, getSenderIdentity, identitiesOverlap, } from "../../identity.js";
import { buildMentionConfig, debugMention, resolveOwnerList } from "../mentions.js";
import { stripMentionsForCommand } from "./commands.js";
import { resolveGroupActivationFor, resolveGroupPolicyFor } from "./group-activation.js";
import { noteGroupMember } from "./group-members.js";
function isOwnerSender(baseMentionConfig, msg) {
    const sender = normalizeE164(getSenderIdentity(msg).e164 ?? "");
    if (!sender) {
        return false;
    }
    const owners = resolveOwnerList(baseMentionConfig, getSelfIdentity(msg).e164 ?? undefined);
    return owners.includes(sender);
}
function recordPendingGroupHistoryEntry(params) {
    const senderIdentity = getSenderIdentity(params.msg);
    const sender = senderIdentity.name && senderIdentity.e164
        ? `${senderIdentity.name} (${senderIdentity.e164})`
        : (senderIdentity.name ??
            senderIdentity.e164 ??
            getPrimaryIdentityId(senderIdentity) ??
            "Unknown");
    recordPendingHistoryEntryIfEnabled({
        historyMap: params.groupHistories,
        historyKey: params.groupHistoryKey,
        limit: params.groupHistoryLimit,
        entry: {
            sender,
            body: params.msg.body,
            timestamp: params.msg.timestamp,
            id: params.msg.id,
            senderJid: senderIdentity.jid ?? params.msg.senderJid,
        },
    });
}
function skipGroupMessageAndStoreHistory(params, verboseMessage) {
    params.logVerbose(verboseMessage);
    recordPendingGroupHistoryEntry({
        msg: params.msg,
        groupHistories: params.groupHistories,
        groupHistoryKey: params.groupHistoryKey,
        groupHistoryLimit: params.groupHistoryLimit,
    });
    return { shouldProcess: false };
}
export function applyGroupGating(params) {
    const sender = getSenderIdentity(params.msg);
    const self = getSelfIdentity(params.msg, params.authDir);
    const groupPolicy = resolveGroupPolicyFor(params.cfg, params.conversationId);
    if (groupPolicy.allowlistEnabled && !groupPolicy.allowed) {
        params.logVerbose(`Skipping group message ${params.conversationId} (not in allowlist)`);
        return { shouldProcess: false };
    }
    noteGroupMember(params.groupMemberNames, params.groupHistoryKey, sender.e164 ?? undefined, sender.name ?? undefined);
    const mentionConfig = buildMentionConfig(params.cfg, params.agentId);
    const commandBody = stripMentionsForCommand(params.msg.body, mentionConfig.mentionRegexes, self.e164);
    const activationCommand = parseActivationCommand(commandBody);
    const owner = isOwnerSender(params.baseMentionConfig, params.msg);
    const shouldBypassMention = owner && hasControlCommand(commandBody, params.cfg);
    if (activationCommand.hasCommand && !owner) {
        return skipGroupMessageAndStoreHistory(params, `Ignoring /activation from non-owner in group ${params.conversationId}`);
    }
    const mentionDebug = debugMention(params.msg, mentionConfig, params.authDir);
    params.replyLogger.debug({
        conversationId: params.conversationId,
        wasMentioned: mentionDebug.wasMentioned,
        ...mentionDebug.details,
    }, "group mention debug");
    const wasMentioned = mentionDebug.wasMentioned;
    const activation = resolveGroupActivationFor({
        cfg: params.cfg,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        conversationId: params.conversationId,
    });
    const requireMention = activation !== "always";
    const replyContext = getReplyContext(params.msg, params.authDir);
    // Detect reply-to-bot: compare JIDs, LIDs, and E.164 numbers.
    // WhatsApp may report the quoted message sender as either a phone JID
    // (xxxxx@s.whatsapp.net) or a LID (xxxxx@lid), so we compare both.
    const implicitMention = identitiesOverlap(self, replyContext?.sender);
    const mentionGate = resolveMentionGating({
        requireMention,
        canDetectMention: true,
        wasMentioned,
        implicitMention,
        shouldBypassMention,
    });
    params.msg.wasMentioned = mentionGate.effectiveWasMentioned;
    if (!shouldBypassMention && requireMention && mentionGate.shouldSkip) {
        return skipGroupMessageAndStoreHistory(params, `Group message stored for context (no mention detected) in ${params.conversationId}: ${params.msg.body}`);
    }
    return { shouldProcess: true };
}
