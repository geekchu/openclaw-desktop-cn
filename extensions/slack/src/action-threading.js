import { parseSlackTarget } from "./targets.js";
export function resolveSlackAutoThreadId(params) {
    const context = params.toolContext;
    if (!context?.currentThreadTs || !context.currentChannelId) {
        return undefined;
    }
    if (context.replyToMode !== "all" && context.replyToMode !== "first") {
        return undefined;
    }
    const parsedTarget = parseSlackTarget(params.to, { defaultKind: "channel" });
    if (!parsedTarget || parsedTarget.kind !== "channel") {
        return undefined;
    }
    if (parsedTarget.id.toLowerCase() !== context.currentChannelId.toLowerCase()) {
        return undefined;
    }
    if (context.replyToMode === "first" && context.hasRepliedRef?.value) {
        return undefined;
    }
    return context.currentThreadTs;
}
