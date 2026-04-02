import { resolveReactionLevel, } from "openclaw/plugin-sdk/text-runtime";
import { resolveTelegramAccount } from "./accounts.js";
/**
 * Resolve the effective reaction level and its implications.
 */
export function resolveTelegramReactionLevel(params) {
    const account = resolveTelegramAccount({
        cfg: params.cfg,
        accountId: params.accountId,
    });
    return resolveReactionLevel({
        value: account.config.reactionLevel,
        defaultLevel: "minimal",
        invalidFallback: "ack",
    });
}
