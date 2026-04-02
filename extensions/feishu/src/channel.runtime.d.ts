import { getChatInfo as getChatInfoImpl, getChatMembers as getChatMembersImpl, getFeishuMemberInfo as getFeishuMemberInfoImpl } from "./chat.js";
import { listFeishuDirectoryGroupsLive as listFeishuDirectoryGroupsLiveImpl, listFeishuDirectoryPeersLive as listFeishuDirectoryPeersLiveImpl } from "./directory.js";
import { createPinFeishu as createPinFeishuImpl, listPinsFeishu as listPinsFeishuImpl, removePinFeishu as removePinFeishuImpl } from "./pins.js";
import { probeFeishu as probeFeishuImpl } from "./probe.js";
import { addReactionFeishu as addReactionFeishuImpl, listReactionsFeishu as listReactionsFeishuImpl, removeReactionFeishu as removeReactionFeishuImpl } from "./reactions.js";
import { editMessageFeishu as editMessageFeishuImpl, getMessageFeishu as getMessageFeishuImpl, sendCardFeishu as sendCardFeishuImpl, sendMessageFeishu as sendMessageFeishuImpl } from "./send.js";
export declare const feishuChannelRuntime: {
    listFeishuDirectoryGroupsLive: typeof listFeishuDirectoryGroupsLiveImpl;
    listFeishuDirectoryPeersLive: typeof listFeishuDirectoryPeersLiveImpl;
    feishuOutbound: {
        deliveryMode: "direct" | "gateway" | "hybrid";
        chunker?: ((text: string, limit: number) => string[]) | null;
        chunkerMode?: "text" | "markdown";
        textChunkLimit?: number;
        pollMaxOptions?: number;
        normalizePayload?: (params: {
            payload: import("../runtime-api.js").ReplyPayload;
        }) => import("../runtime-api.js").ReplyPayload | null;
        shouldSkipPlainTextSanitization?: (params: {
            payload: import("../runtime-api.js").ReplyPayload;
        }) => boolean;
        resolveEffectiveTextChunkLimit?: (params: {
            cfg: import("../runtime-api.js").ClawdbotConfig;
            accountId?: string | null;
            fallbackLimit?: number;
        }) => number | undefined;
        resolveTarget?: (params: {
            cfg?: import("../runtime-api.js").ClawdbotConfig;
            to?: string;
            allowFrom?: string[];
            accountId?: string | null;
            mode?: import("../../../dist/plugin-sdk/channel-runtime.js").ChannelOutboundTargetMode;
        }) => {
            ok: true;
            to: string;
        } | {
            ok: false;
            error: Error;
        };
        sendPayload?: (ctx: import("../../../dist/plugin-sdk/src/channels/plugins/types.adapters.js").ChannelOutboundPayloadContext) => Promise<import("../../../dist/plugin-sdk/src/infra/outbound/deliver.js").OutboundDeliveryResult>;
        sendFormattedText?: (ctx: import("../../../dist/plugin-sdk/src/channels/plugins/types.adapters.js").ChannelOutboundFormattedContext) => Promise<import("../../../dist/plugin-sdk/src/infra/outbound/deliver.js").OutboundDeliveryResult[]>;
        sendFormattedMedia?: (ctx: import("../../../dist/plugin-sdk/src/channels/plugins/types.adapters.js").ChannelOutboundFormattedContext & {
            mediaUrl: string;
        }) => Promise<import("../../../dist/plugin-sdk/src/infra/outbound/deliver.js").OutboundDeliveryResult>;
        sendText?: (ctx: import("../../../dist/plugin-sdk/channel-runtime.js").ChannelOutboundContext) => Promise<import("../../../dist/plugin-sdk/src/infra/outbound/deliver.js").OutboundDeliveryResult>;
        sendMedia?: (ctx: import("../../../dist/plugin-sdk/channel-runtime.js").ChannelOutboundContext) => Promise<import("../../../dist/plugin-sdk/src/infra/outbound/deliver.js").OutboundDeliveryResult>;
        sendPoll?: (ctx: import("../../../dist/plugin-sdk/channel-runtime.js").ChannelPollContext) => Promise<import("../../../dist/plugin-sdk/channel-runtime.js").ChannelPollResult>;
    };
    createPinFeishu: typeof createPinFeishuImpl;
    listPinsFeishu: typeof listPinsFeishuImpl;
    removePinFeishu: typeof removePinFeishuImpl;
    probeFeishu: typeof probeFeishuImpl;
    addReactionFeishu: typeof addReactionFeishuImpl;
    listReactionsFeishu: typeof listReactionsFeishuImpl;
    removeReactionFeishu: typeof removeReactionFeishuImpl;
    getChatInfo: typeof getChatInfoImpl;
    getChatMembers: typeof getChatMembersImpl;
    getFeishuMemberInfo: typeof getFeishuMemberInfoImpl;
    editMessageFeishu: typeof editMessageFeishuImpl;
    getMessageFeishu: typeof getMessageFeishuImpl;
    sendCardFeishu: typeof sendCardFeishuImpl;
    sendMessageFeishu: typeof sendMessageFeishuImpl;
};
