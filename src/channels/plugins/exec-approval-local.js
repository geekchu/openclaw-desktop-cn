import { getChannelPlugin, normalizeChannelId } from "./registry.js";
export function shouldSuppressLocalExecApprovalPrompt(params) {
    const channel = params.channel ? normalizeChannelId(params.channel) : null;
    if (!channel) {
        return false;
    }
    return (getChannelPlugin(channel)?.execApprovals?.shouldSuppressLocalPrompt?.({
        cfg: params.cfg,
        accountId: params.accountId,
        payload: params.payload,
    }) ?? false);
}
