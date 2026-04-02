import { getExecApprovalReplyMetadata } from "openclaw/plugin-sdk/approval-runtime";
import { resolveTelegramAccount } from "./accounts.js";
import { resolveTelegramInlineButtonsConfigScope } from "./inline-buttons.js";
import { resolveTelegramTargetChatType } from "./targets.js";
function normalizeApproverId(value) {
    return String(value).trim();
}
export function resolveTelegramExecApprovalConfig(params) {
    return resolveTelegramAccount(params).config.execApprovals;
}
export function getTelegramExecApprovalApprovers(params) {
    return (resolveTelegramExecApprovalConfig(params)?.approvers ?? [])
        .map(normalizeApproverId)
        .filter(Boolean);
}
export function isTelegramExecApprovalClientEnabled(params) {
    const config = resolveTelegramExecApprovalConfig(params);
    return Boolean(config?.enabled && getTelegramExecApprovalApprovers(params).length > 0);
}
export function isTelegramExecApprovalApprover(params) {
    const senderId = params.senderId?.trim();
    if (!senderId) {
        return false;
    }
    const approvers = getTelegramExecApprovalApprovers(params);
    return approvers.includes(senderId);
}
export function resolveTelegramExecApprovalTarget(params) {
    return resolveTelegramExecApprovalConfig(params)?.target ?? "dm";
}
export function shouldInjectTelegramExecApprovalButtons(params) {
    if (!isTelegramExecApprovalClientEnabled(params)) {
        return false;
    }
    const target = resolveTelegramExecApprovalTarget(params);
    const chatType = resolveTelegramTargetChatType(params.to);
    if (chatType === "direct") {
        return target === "dm" || target === "both";
    }
    if (chatType === "group") {
        return target === "channel" || target === "both";
    }
    return target === "both";
}
function resolveExecApprovalButtonsExplicitlyDisabled(params) {
    const capabilities = resolveTelegramAccount(params).config.capabilities;
    return resolveTelegramInlineButtonsConfigScope(capabilities) === "off";
}
export function shouldEnableTelegramExecApprovalButtons(params) {
    if (!shouldInjectTelegramExecApprovalButtons(params)) {
        return false;
    }
    return !resolveExecApprovalButtonsExplicitlyDisabled(params);
}
export function shouldSuppressLocalTelegramExecApprovalPrompt(params) {
    void params.cfg;
    void params.accountId;
    return getExecApprovalReplyMetadata(params.payload) !== null;
}
