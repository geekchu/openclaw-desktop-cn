import { resolveChannelGroupRequireMention } from "openclaw/plugin-sdk/channel-policy";
import { resolveExactLineGroupConfigKey } from "../runtime-api.js";
export function resolveLineGroupRequireMention(params) {
    const exactGroupId = resolveExactLineGroupConfigKey({
        cfg: params.cfg,
        accountId: params.accountId,
        groupId: params.groupId,
    });
    return resolveChannelGroupRequireMention({
        cfg: params.cfg,
        channel: "line",
        groupId: exactGroupId ?? params.groupId,
        accountId: params.accountId,
    });
}
