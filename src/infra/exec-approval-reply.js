export function getExecApprovalApproverDmNoticeText() {
    return "Approval required. I sent the allowed approvers DMs.";
}
function buildFence(text, language) {
    let fence = "```";
    while (text.includes(fence)) {
        fence += "`";
    }
    const languagePrefix = language ? language : "";
    return `${fence}${languagePrefix}\n${text}\n${fence}`;
}
export function getExecApprovalReplyMetadata(payload) {
    const channelData = payload.channelData;
    if (!channelData || typeof channelData !== "object" || Array.isArray(channelData)) {
        return null;
    }
    const execApproval = channelData.execApproval;
    if (!execApproval || typeof execApproval !== "object" || Array.isArray(execApproval)) {
        return null;
    }
    const record = execApproval;
    const approvalId = typeof record.approvalId === "string" ? record.approvalId.trim() : "";
    const approvalSlug = typeof record.approvalSlug === "string" ? record.approvalSlug.trim() : "";
    if (!approvalId || !approvalSlug) {
        return null;
    }
    const allowedDecisions = Array.isArray(record.allowedDecisions)
        ? record.allowedDecisions.filter((value) => value === "allow-once" || value === "allow-always" || value === "deny")
        : undefined;
    return {
        approvalId,
        approvalSlug,
        allowedDecisions,
    };
}
export function buildExecApprovalPendingReplyPayload(params) {
    const approvalCommandId = params.approvalCommandId?.trim() || params.approvalSlug;
    const lines = [];
    const warningText = params.warningText?.trim();
    if (warningText) {
        lines.push(warningText);
    }
    lines.push("Approval required.");
    lines.push("Run:");
    lines.push(buildFence(`/approve ${approvalCommandId} allow-once`, "txt"));
    lines.push("Pending command:");
    lines.push(buildFence(params.command, "sh"));
    lines.push("Other options:");
    lines.push(buildFence(`/approve ${approvalCommandId} allow-always\n/approve ${approvalCommandId} deny`, "txt"));
    const info = [];
    info.push(`Host: ${params.host}`);
    if (params.nodeId) {
        info.push(`Node: ${params.nodeId}`);
    }
    if (params.cwd) {
        info.push(`CWD: ${params.cwd}`);
    }
    if (typeof params.expiresAtMs === "number" && Number.isFinite(params.expiresAtMs)) {
        const expiresInSec = Math.max(0, Math.round((params.expiresAtMs - (params.nowMs ?? Date.now())) / 1000));
        info.push(`Expires in: ${expiresInSec}s`);
    }
    info.push(`Full id: \`${params.approvalId}\``);
    lines.push(info.join("\n"));
    return {
        text: lines.join("\n\n"),
        channelData: {
            execApproval: {
                approvalId: params.approvalId,
                approvalSlug: params.approvalSlug,
                allowedDecisions: ["allow-once", "allow-always", "deny"],
            },
        },
    };
}
export function buildExecApprovalUnavailableReplyPayload(params) {
    const lines = [];
    const warningText = params.warningText?.trim();
    if (warningText) {
        lines.push(warningText);
    }
    if (params.sentApproverDms) {
        lines.push(getExecApprovalApproverDmNoticeText());
        return {
            text: lines.join("\n\n"),
        };
    }
    if (params.reason === "initiating-platform-disabled") {
        lines.push(`Exec approval is required, but chat exec approvals are not enabled on ${params.channelLabel ?? "this platform"}.`);
        lines.push("Approve it from the Web UI or terminal UI, or from Discord or Telegram if those approval clients are enabled.");
    }
    else if (params.reason === "initiating-platform-unsupported") {
        lines.push(`Exec approval is required, but ${params.channelLabel ?? "this platform"} does not support chat exec approvals.`);
        lines.push("Approve it from the Web UI or terminal UI, or from Discord or Telegram if those approval clients are enabled.");
    }
    else {
        lines.push("Exec approval is required, but no interactive approval client is currently available.");
        lines.push("Open the Web UI or terminal UI, or enable Discord or Telegram exec approvals, then retry the command.");
    }
    return {
        text: lines.join("\n\n"),
    };
}
