import { resolveOutboundSendDep } from "openclaw/plugin-sdk/outbound-runtime";
import { PAIRING_APPROVED_MESSAGE, resolveChannelMediaMaxBytes } from "../runtime-api.js";
import { monitorIMessageProvider } from "./monitor.js";
import { probeIMessage } from "./probe.js";
import { getIMessageRuntime } from "./runtime.js";
import { imessageSetupWizard } from "./setup-surface.js";
export async function sendIMessageOutbound(params) {
    const send = resolveOutboundSendDep(params.deps, "imessage") ??
        getIMessageRuntime().channel.imessage.sendMessageIMessage;
    const maxBytes = resolveChannelMediaMaxBytes({
        cfg: params.cfg,
        resolveChannelLimitMb: ({ cfg, accountId }) => cfg.channels?.imessage?.accounts?.[accountId]?.mediaMaxMb ??
            cfg.channels?.imessage?.mediaMaxMb,
        accountId: params.accountId,
    });
    return await send(params.to, params.text, {
        config: params.cfg,
        ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
        ...(params.mediaLocalRoots?.length ? { mediaLocalRoots: params.mediaLocalRoots } : {}),
        maxBytes,
        accountId: params.accountId ?? undefined,
        replyToId: params.replyToId ?? undefined,
    });
}
export async function notifyIMessageApproval(id) {
    await getIMessageRuntime().channel.imessage.sendMessageIMessage(id, PAIRING_APPROVED_MESSAGE);
}
export async function probeIMessageAccount(timeoutMs) {
    return await probeIMessage(timeoutMs);
}
export async function startIMessageGatewayAccount(ctx) {
    const account = ctx.account;
    const cliPath = account.config.cliPath?.trim() || "imsg";
    const dbPath = account.config.dbPath?.trim();
    ctx.setStatus({
        accountId: account.accountId,
        cliPath,
        dbPath: dbPath ?? null,
    });
    ctx.log?.info?.(`[${account.accountId}] starting provider (${cliPath}${dbPath ? ` db=${dbPath}` : ""})`);
    return await monitorIMessageProvider({
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
    });
}
export { imessageSetupWizard };
