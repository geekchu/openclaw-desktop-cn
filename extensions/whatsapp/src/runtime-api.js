export { buildChannelConfigSchema, createActionGate, DEFAULT_ACCOUNT_ID, formatWhatsAppConfigAllowFromEntries, getChatChannelMeta, jsonResult, normalizeE164, readReactionParams, readStringParam, resolveWhatsAppGroupIntroHint, resolveWhatsAppGroupRequireMention, resolveWhatsAppGroupToolPolicy, ToolAuthorizationError, WhatsAppConfigSchema, } from "openclaw/plugin-sdk/whatsapp-core";
export { createWhatsAppOutboundBase, looksLikeWhatsAppTargetId, normalizeWhatsAppAllowFromEntries, normalizeWhatsAppMessagingTarget, resolveWhatsAppHeartbeatRecipients, resolveWhatsAppMentionStripRegexes, } from "openclaw/plugin-sdk/whatsapp-shared";
export { isWhatsAppGroupJid, isWhatsAppUserTarget, normalizeWhatsAppTarget, } from "./normalize-target.js";
export { resolveWhatsAppOutboundTarget } from "./resolve-outbound-target.js";
let channelRuntimePromise = null;
function loadChannelRuntime() {
    channelRuntimePromise ??= import("./channel.runtime.js");
    return channelRuntimePromise;
}
export async function monitorWebChannel(...args) {
    const { monitorWebChannel } = await loadChannelRuntime();
    return await monitorWebChannel(...args);
}
