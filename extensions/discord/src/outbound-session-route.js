import { buildOutboundBaseSessionKey, normalizeOutboundThreadId, resolveThreadSessionKeys, } from "openclaw/plugin-sdk/routing";
import { parseDiscordTarget } from "./targets.js";
export function resolveDiscordOutboundSessionRoute(params) {
    const parsed = parseDiscordTarget(params.target, {
        defaultKind: resolveDiscordOutboundTargetKindHint(params),
    });
    if (!parsed) {
        return null;
    }
    const isDm = parsed.kind === "user";
    const peer = {
        kind: isDm ? "direct" : "channel",
        id: parsed.id,
    };
    const baseSessionKey = buildOutboundBaseSessionKey({
        cfg: params.cfg,
        agentId: params.agentId,
        channel: "discord",
        accountId: params.accountId,
        peer,
    });
    const explicitThreadId = normalizeOutboundThreadId(params.threadId);
    const threadCandidate = explicitThreadId ?? normalizeOutboundThreadId(params.replyToId);
    const threadKeys = resolveThreadSessionKeys({
        baseSessionKey,
        threadId: threadCandidate,
        useSuffix: false,
    });
    return {
        sessionKey: threadKeys.sessionKey,
        baseSessionKey,
        peer,
        chatType: isDm ? "direct" : "channel",
        from: isDm ? `discord:${parsed.id}` : `discord:channel:${parsed.id}`,
        to: isDm ? `user:${parsed.id}` : `channel:${parsed.id}`,
        threadId: explicitThreadId ?? undefined,
    };
}
function resolveDiscordOutboundTargetKindHint(params) {
    const resolvedKind = params.resolvedTarget?.kind;
    if (resolvedKind === "user") {
        return "user";
    }
    if (resolvedKind === "group" || resolvedKind === "channel") {
        return "channel";
    }
    const target = params.target.trim();
    if (/^channel:/i.test(target)) {
        return "channel";
    }
    if (/^(user:|discord:|@|<@!?)/i.test(target)) {
        return "user";
    }
    return undefined;
}
