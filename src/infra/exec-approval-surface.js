import { getChannelPlugin, listChannelPlugins } from "../channels/plugins/index.js";
import { loadConfig } from "../config/config.js";
import { INTERNAL_MESSAGE_CHANNEL, normalizeMessageChannel } from "../utils/message-channel.js";
function labelForChannel(channel) {
    switch (channel) {
        case "discord":
            return "Discord";
        case "telegram":
            return "Telegram";
        case "tui":
            return "terminal UI";
        case INTERNAL_MESSAGE_CHANNEL:
            return "Web UI";
        default:
            return channel ? channel[0]?.toUpperCase() + channel.slice(1) : "this platform";
    }
}
export function resolveExecApprovalInitiatingSurfaceState(params) {
    const channel = normalizeMessageChannel(params.channel);
    const channelLabel = labelForChannel(channel);
    if (!channel || channel === INTERNAL_MESSAGE_CHANNEL || channel === "tui") {
        return { kind: "enabled", channel, channelLabel };
    }
    const cfg = params.cfg ?? loadConfig();
    const state = getChannelPlugin(channel)?.execApprovals?.getInitiatingSurfaceState?.({
        cfg,
        accountId: params.accountId,
    });
    if (state) {
        return { ...state, channel, channelLabel };
    }
    return { kind: "unsupported", channel, channelLabel };
}
export function hasConfiguredExecApprovalDmRoute(cfg) {
    return listChannelPlugins().some((plugin) => plugin.execApprovals?.hasConfiguredDmRoute?.({ cfg }) ?? false);
}
