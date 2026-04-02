import { readStringParam } from "../../agents/tools/common.js";
export function resolveAndApplyOutboundThreadId(actionParams, context) {
    const threadId = readStringParam(actionParams, "threadId");
    const resolved = threadId ??
        context.resolveAutoThreadId?.({
            cfg: context.cfg,
            accountId: context.accountId,
            to: context.to,
            toolContext: context.toolContext,
            replyToId: readStringParam(actionParams, "replyTo"),
        });
    if (resolved && !actionParams.threadId) {
        actionParams.threadId = resolved;
    }
    return resolved ?? undefined;
}
export async function prepareOutboundMirrorRoute(params) {
    const replyToId = readStringParam(params.actionParams, "replyTo");
    const resolvedThreadId = resolveAndApplyOutboundThreadId(params.actionParams, {
        cfg: params.cfg,
        to: params.to,
        accountId: params.accountId,
        toolContext: params.toolContext,
        resolveAutoThreadId: params.resolveAutoThreadId,
    });
    const outboundRoute = params.agentId && !params.dryRun
        ? await params.resolveOutboundSessionRoute({
            cfg: params.cfg,
            channel: params.channel,
            agentId: params.agentId,
            accountId: params.accountId,
            target: params.to,
            resolvedTarget: params.resolvedTarget,
            replyToId,
            threadId: resolvedThreadId,
        })
        : null;
    if (outboundRoute && params.agentId && !params.dryRun) {
        await params.ensureOutboundSessionEntry({
            cfg: params.cfg,
            agentId: params.agentId,
            channel: params.channel,
            accountId: params.accountId,
            route: outboundRoute,
        });
    }
    if (outboundRoute && !params.dryRun) {
        params.actionParams.__sessionKey = outboundRoute.sessionKey;
    }
    if (params.agentId) {
        params.actionParams.__agentId = params.agentId;
    }
    return {
        resolvedThreadId,
        outboundRoute,
    };
}
