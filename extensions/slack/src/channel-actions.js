import { Type } from "@sinclair/typebox";
import { handleSlackAction } from "./action-runtime.js";
import { isSlackInteractiveRepliesEnabled } from "./interactive-replies.js";
import { handleSlackMessageAction } from "./message-action-dispatch.js";
import { extractSlackToolSend, listSlackMessageActions } from "./message-actions.js";
import { createSlackMessageToolBlocksSchema } from "./message-tool-schema.js";
import { resolveSlackChannelId } from "./targets.js";
export function createSlackActions(providerId, options) {
    function describeMessageTool({ cfg, accountId, }) {
        const actions = listSlackMessageActions(cfg, accountId);
        const capabilities = new Set();
        if (actions.includes("send")) {
            capabilities.add("blocks");
        }
        if (isSlackInteractiveRepliesEnabled({ cfg, accountId })) {
            capabilities.add("interactive");
        }
        return {
            actions,
            capabilities: Array.from(capabilities),
            schema: actions.includes("send")
                ? {
                    properties: {
                        blocks: Type.Optional(createSlackMessageToolBlocksSchema()),
                    },
                }
                : null,
        };
    }
    return {
        describeMessageTool,
        extractToolSend: ({ args }) => extractSlackToolSend(args),
        handleAction: async (ctx) => {
            return await handleSlackMessageAction({
                providerId,
                ctx,
                normalizeChannelId: resolveSlackChannelId,
                includeReadThreadId: true,
                invoke: async (action, cfg, toolContext) => await (options?.invoke
                    ? options.invoke(action, cfg, toolContext)
                    : handleSlackAction(action, cfg, {
                        ...toolContext,
                        mediaLocalRoots: ctx.mediaLocalRoots,
                        mediaReadFile: ctx.mediaReadFile,
                    })),
            });
        },
    };
}
