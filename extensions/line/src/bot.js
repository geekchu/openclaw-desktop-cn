import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { DEFAULT_GROUP_HISTORY_LIMIT } from "openclaw/plugin-sdk/reply-history";
import { createNonExitingRuntime, logVerbose, } from "openclaw/plugin-sdk/runtime-env";
import { resolveLineAccount } from "./accounts.js";
import { createLineWebhookReplayCache, handleLineWebhookEvents } from "./bot-handlers.js";
import { startLineWebhook } from "./webhook.js";
export function createLineBot(opts) {
    const runtime = opts.runtime ?? createNonExitingRuntime();
    const cfg = opts.config ?? loadConfig();
    const account = resolveLineAccount({
        cfg,
        accountId: opts.accountId,
    });
    const mediaMaxBytes = (opts.mediaMaxMb ?? account.config.mediaMaxMb ?? 10) * 1024 * 1024;
    const processMessage = opts.onMessage ??
        (async () => {
            logVerbose("line: no message handler configured");
        });
    const replayCache = createLineWebhookReplayCache();
    const groupHistories = new Map();
    const handleWebhook = async (body) => {
        if (!body.events || body.events.length === 0) {
            return;
        }
        await handleLineWebhookEvents(body.events, {
            cfg,
            account,
            runtime,
            mediaMaxBytes,
            processMessage,
            replayCache,
            groupHistories,
            historyLimit: cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
        });
    };
    return {
        handleWebhook,
        account,
    };
}
export function createLineWebhookCallback(bot, channelSecret, path = "/line/webhook") {
    const { handler } = startLineWebhook({
        channelSecret,
        onEvents: bot.handleWebhook,
        path,
    });
    return { path, handler };
}
