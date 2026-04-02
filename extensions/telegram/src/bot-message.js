import { danger, logVerbose, shouldLogVerbose } from "openclaw/plugin-sdk/runtime-env";
import { buildTelegramMessageContext, } from "./bot-message-context.js";
import { dispatchTelegramMessage } from "./bot-message-dispatch.js";
import { buildTelegramThreadParams } from "./bot/helpers.js";
export const createTelegramMessageProcessor = (deps) => {
    const { bot, cfg, account, telegramCfg, historyLimit, groupHistories, dmPolicy, allowFrom, groupAllowFrom, ackReactionScope, logger, resolveGroupActivation, resolveGroupRequireMention, resolveTelegramGroupConfig, loadFreshConfig, sendChatActionHandler, runtime, replyToMode, streamMode, textLimit, telegramDeps, opts, } = deps;
    return async (primaryCtx, allMedia, storeAllowFrom, options, replyMedia) => {
        const ingressReceivedAtMs = typeof options?.receivedAtMs === "number" && Number.isFinite(options.receivedAtMs)
            ? options.receivedAtMs
            : undefined;
        const ingressDebugEnabled = shouldLogVerbose() || process.env.OPENCLAW_DEBUG_TELEGRAM_INGRESS === "1";
        const ingressContextStartMs = ingressReceivedAtMs ? Date.now() : undefined;
        const context = await buildTelegramMessageContext({
            primaryCtx,
            allMedia,
            replyMedia,
            storeAllowFrom,
            options,
            bot,
            cfg,
            account,
            historyLimit,
            groupHistories,
            dmPolicy,
            allowFrom,
            groupAllowFrom,
            ackReactionScope,
            logger,
            resolveGroupActivation,
            resolveGroupRequireMention,
            resolveTelegramGroupConfig,
            sendChatActionHandler,
            loadFreshConfig,
            upsertPairingRequest: telegramDeps.upsertChannelPairingRequest,
        });
        if (!context) {
            if (ingressDebugEnabled && ingressReceivedAtMs && ingressContextStartMs) {
                logVerbose(`telegram ingress: chatId=${primaryCtx.message.chat.id} dropped after ${Date.now() - ingressReceivedAtMs}ms` +
                    `${options?.ingressBuffer ? ` buffer=${options.ingressBuffer}` : ""}`);
            }
            return;
        }
        if (ingressDebugEnabled && ingressReceivedAtMs && ingressContextStartMs) {
            logVerbose(`telegram ingress: chatId=${context.chatId} contextReadyMs=${Date.now() - ingressReceivedAtMs}` +
                ` preDispatchMs=${Date.now() - ingressContextStartMs}` +
                `${options?.ingressBuffer ? ` buffer=${options.ingressBuffer}` : ""}`);
        }
        try {
            await dispatchTelegramMessage({
                context,
                bot,
                cfg,
                runtime,
                replyToMode,
                streamMode,
                textLimit,
                telegramCfg,
                telegramDeps,
                opts,
            });
            if (ingressDebugEnabled && ingressReceivedAtMs) {
                logVerbose(`telegram ingress: chatId=${context.chatId} dispatchCompleteMs=${Date.now() - ingressReceivedAtMs}` +
                    `${options?.ingressBuffer ? ` buffer=${options.ingressBuffer}` : ""}`);
            }
        }
        catch (err) {
            runtime.error?.(danger(`telegram message processing failed: ${String(err)}`));
            try {
                await bot.api.sendMessage(context.chatId, "Something went wrong while processing your request. Please try again.", buildTelegramThreadParams(context.threadSpec));
            }
            catch {
                // Best-effort fallback; delivery may fail if the bot was blocked or the chat is invalid.
            }
        }
    };
};
