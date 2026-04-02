import { createUnionActionGate, listTokenSourcedAccounts, resolveReactionMessageId, } from "openclaw/plugin-sdk/channel-actions";
import { createMessageToolButtonsSchema } from "openclaw/plugin-sdk/channel-actions";
import { extractToolSend } from "openclaw/plugin-sdk/tool-send";
import { createTelegramActionGate, listEnabledTelegramAccounts, resolveTelegramPollActionGateState, } from "./accounts.js";
import { handleTelegramAction } from "./action-runtime.js";
import { isTelegramInlineButtonsEnabled } from "./inline-buttons.js";
import { createTelegramPollExtraToolSchemas } from "./message-tool-schema.js";
export const telegramMessageActionRuntime = {
    handleTelegramAction,
};
const TELEGRAM_MESSAGE_ACTION_MAP = {
    delete: "deleteMessage",
    edit: "editMessage",
    poll: "poll",
    react: "react",
    send: "sendMessage",
    sticker: "sendSticker",
    "sticker-search": "searchSticker",
    "topic-create": "createForumTopic",
    "topic-edit": "editForumTopic",
};
function resolveTelegramMessageActionName(action) {
    return TELEGRAM_MESSAGE_ACTION_MAP[action];
}
function resolveTelegramActionDiscovery(cfg) {
    const accounts = listTokenSourcedAccounts(listEnabledTelegramAccounts(cfg));
    if (accounts.length === 0) {
        return null;
    }
    const unionGate = createUnionActionGate(accounts, (account) => createTelegramActionGate({
        cfg,
        accountId: account.accountId,
    }));
    const pollEnabled = accounts.some((account) => {
        const accountGate = createTelegramActionGate({
            cfg,
            accountId: account.accountId,
        });
        return resolveTelegramPollActionGateState(accountGate).enabled;
    });
    const buttonsEnabled = accounts.some((account) => isTelegramInlineButtonsEnabled({ cfg, accountId: account.accountId }));
    return {
        isEnabled: (key, defaultValue = true) => unionGate(key, defaultValue),
        pollEnabled,
        buttonsEnabled,
    };
}
function describeTelegramMessageTool({ cfg, }) {
    const discovery = resolveTelegramActionDiscovery(cfg);
    if (!discovery) {
        return {
            actions: [],
            capabilities: [],
            schema: null,
        };
    }
    const actions = new Set(["send"]);
    if (discovery.pollEnabled) {
        actions.add("poll");
    }
    if (discovery.isEnabled("reactions")) {
        actions.add("react");
    }
    if (discovery.isEnabled("deleteMessage")) {
        actions.add("delete");
    }
    if (discovery.isEnabled("editMessage")) {
        actions.add("edit");
    }
    if (discovery.isEnabled("sticker", false)) {
        actions.add("sticker");
        actions.add("sticker-search");
    }
    if (discovery.isEnabled("createForumTopic")) {
        actions.add("topic-create");
    }
    if (discovery.isEnabled("editForumTopic")) {
        actions.add("topic-edit");
    }
    const schema = [];
    if (discovery.buttonsEnabled) {
        schema.push({
            properties: {
                buttons: createMessageToolButtonsSchema(),
            },
        });
    }
    if (discovery.pollEnabled) {
        schema.push({
            properties: createTelegramPollExtraToolSchemas(),
            visibility: "all-configured",
        });
    }
    return {
        actions: Array.from(actions),
        capabilities: discovery.buttonsEnabled ? ["interactive", "buttons"] : [],
        schema,
    };
}
export const telegramMessageActions = {
    describeMessageTool: describeTelegramMessageTool,
    extractToolSend: ({ args }) => {
        return extractToolSend(args, "sendMessage");
    },
    handleAction: async ({ action, params, cfg, accountId, mediaLocalRoots, toolContext }) => {
        const telegramAction = resolveTelegramMessageActionName(action);
        if (!telegramAction) {
            throw new Error(`Unsupported Telegram action: ${action}`);
        }
        return await telegramMessageActionRuntime.handleTelegramAction({
            ...params,
            action: telegramAction,
            accountId: accountId ?? undefined,
            ...(action === "react"
                ? {
                    messageId: resolveReactionMessageId({ args: params, toolContext }),
                }
                : {}),
        }, cfg, { mediaLocalRoots });
    },
};
