import { resolveDefaultSlackAccountId, resolveSlackAccount } from "./accounts.js";
function resolveInteractiveRepliesFromCapabilities(capabilities) {
    if (!capabilities) {
        return false;
    }
    if (Array.isArray(capabilities)) {
        return capabilities.some((entry) => String(entry).trim().toLowerCase() === "interactivereplies");
    }
    if (typeof capabilities === "object") {
        return capabilities.interactiveReplies === true;
    }
    return false;
}
export function isSlackInteractiveRepliesEnabled(params) {
    const account = resolveSlackAccount({
        cfg: params.cfg,
        accountId: params.accountId ?? resolveDefaultSlackAccountId(params.cfg),
    });
    return resolveInteractiveRepliesFromCapabilities(account.config.capabilities);
}
