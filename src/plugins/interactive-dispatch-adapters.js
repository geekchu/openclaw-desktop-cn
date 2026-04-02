import { detachPluginConversationBinding, getCurrentPluginConversationBinding, requestPluginConversationBinding, } from "./conversation-binding.js";
function createConversationBindingHelpers(params) {
    const { registration, senderId, conversation } = params;
    const pluginRoot = registration.pluginRoot;
    return {
        requestConversationBinding: async (binding = {}) => {
            if (!pluginRoot) {
                return {
                    status: "error",
                    message: "This interaction cannot bind the current conversation.",
                };
            }
            return requestPluginConversationBinding({
                pluginId: registration.pluginId,
                pluginName: registration.pluginName,
                pluginRoot,
                requestedBySenderId: senderId,
                conversation,
                binding,
            });
        },
        detachConversationBinding: async () => {
            if (!pluginRoot) {
                return { removed: false };
            }
            return detachPluginConversationBinding({
                pluginRoot,
                conversation,
            });
        },
        getCurrentConversationBinding: async () => {
            if (!pluginRoot) {
                return null;
            }
            return getCurrentPluginConversationBinding({
                pluginRoot,
                conversation,
            });
        },
    };
}
export function dispatchTelegramInteractiveHandler(params) {
    const { callbackMessage, ...handlerContext } = params.ctx;
    return params.registration.handler({
        ...handlerContext,
        channel: "telegram",
        callback: {
            data: params.data,
            namespace: params.namespace,
            payload: params.payload,
            messageId: callbackMessage.messageId,
            chatId: callbackMessage.chatId,
            messageText: callbackMessage.messageText,
        },
        respond: params.respond,
        ...createConversationBindingHelpers({
            registration: params.registration,
            senderId: handlerContext.senderId,
            conversation: {
                channel: "telegram",
                accountId: handlerContext.accountId,
                conversationId: handlerContext.conversationId,
                parentConversationId: handlerContext.parentConversationId,
                threadId: handlerContext.threadId,
            },
        }),
    });
}
export function dispatchDiscordInteractiveHandler(params) {
    const handlerContext = params.ctx;
    return params.registration.handler({
        ...handlerContext,
        channel: "discord",
        interaction: {
            ...handlerContext.interaction,
            data: params.data,
            namespace: params.namespace,
            payload: params.payload,
        },
        respond: params.respond,
        ...createConversationBindingHelpers({
            registration: params.registration,
            senderId: handlerContext.senderId,
            conversation: {
                channel: "discord",
                accountId: handlerContext.accountId,
                conversationId: handlerContext.conversationId,
                parentConversationId: handlerContext.parentConversationId,
            },
        }),
    });
}
export function dispatchSlackInteractiveHandler(params) {
    const handlerContext = params.ctx;
    return params.registration.handler({
        ...handlerContext,
        channel: "slack",
        interaction: {
            ...handlerContext.interaction,
            data: params.data,
            namespace: params.namespace,
            payload: params.payload,
        },
        respond: params.respond,
        ...createConversationBindingHelpers({
            registration: params.registration,
            senderId: handlerContext.senderId,
            conversation: {
                channel: "slack",
                accountId: handlerContext.accountId,
                conversationId: handlerContext.conversationId,
                parentConversationId: handlerContext.parentConversationId,
                threadId: handlerContext.threadId,
            },
        }),
    });
}
