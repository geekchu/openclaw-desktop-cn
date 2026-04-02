import { createReplyPrefixOptions, } from "../channels/reply-prefix.js";
import { createTypingCallbacks, } from "../channels/typing.js";
export function createChannelReplyPipeline(params) {
    return {
        ...createReplyPrefixOptions({
            cfg: params.cfg,
            agentId: params.agentId,
            channel: params.channel,
            accountId: params.accountId,
        }),
        ...(params.typingCallbacks
            ? { typingCallbacks: params.typingCallbacks }
            : params.typing
                ? { typingCallbacks: createTypingCallbacks(params.typing) }
                : {}),
    };
}
