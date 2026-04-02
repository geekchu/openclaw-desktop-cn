import { getExecApprovalReplyMetadata } from "openclaw/plugin-sdk/approval-runtime";
import { resolveDiscordAccount } from "./accounts.js";
export function isDiscordExecApprovalClientEnabled(params) {
    const config = resolveDiscordAccount(params).config.execApprovals;
    return Boolean(config?.enabled && (config.approvers?.length ?? 0) > 0);
}
export function isDiscordExecApprovalApprover(params) {
    const senderId = params.senderId?.trim();
    if (!senderId) {
        return false;
    }
    const approvers = resolveDiscordAccount(params).config.execApprovals?.approvers ?? [];
    return approvers.some((approverId) => String(approverId) === senderId);
}
export function shouldSuppressLocalDiscordExecApprovalPrompt(params) {
    return (isDiscordExecApprovalClientEnabled(params) &&
        getExecApprovalReplyMetadata(params.payload) !== null);
}
