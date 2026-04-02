import { type ClawdbotConfig, type OutboundIdentity, type ReplyPayload, type RuntimeEnv } from "../runtime-api.js";
import type { MentionTarget } from "./mention.js";
export type CreateFeishuReplyDispatcherParams = {
    cfg: ClawdbotConfig;
    agentId: string;
    runtime: RuntimeEnv;
    chatId: string;
    replyToMessageId?: string;
    /** When true, preserve typing indicator on reply target but send messages without reply metadata */
    skipReplyToInMessages?: boolean;
    replyInThread?: boolean;
    /** True when inbound message is already inside a thread/topic context */
    threadReply?: boolean;
    rootId?: string;
    mentionTargets?: MentionTarget[];
    accountId?: string;
    identity?: OutboundIdentity;
    /** Epoch ms when the inbound message was created. Used to suppress typing
     *  indicators on old/replayed messages after context compaction (#30418). */
    messageCreateTimeMs?: number;
};
export declare function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams): {
    dispatcher: import("../../../dist/plugin-sdk/reply-runtime.js").ReplyDispatcher;
    replyOptions: {
        onModelSelected: (ctx: import("../../../dist/plugin-sdk/src/auto-reply/types.js").ModelSelectedContext) => void;
        disableBlockStreaming: boolean;
        onPartialReply: ((payload: ReplyPayload) => void) | undefined;
        onReasoningStream: ((payload: ReplyPayload) => void) | undefined;
        onReasoningEnd: (() => void) | undefined;
        onReplyStart?: (() => Promise<void> | void) | undefined;
        onTypingCleanup?: (() => void) | undefined;
        onTypingController?: ((typing: import("../../../dist/plugin-sdk/src/auto-reply/reply/typing.js").TypingController) => void) | undefined;
    };
    markDispatchIdle: () => void;
};
