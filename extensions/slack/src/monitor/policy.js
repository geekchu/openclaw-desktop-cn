import { evaluateGroupRouteAccessForPolicy } from "openclaw/plugin-sdk/group-access";
export function isSlackChannelAllowedByPolicy(params) {
    return evaluateGroupRouteAccessForPolicy({
        groupPolicy: params.groupPolicy,
        routeAllowlistConfigured: params.channelAllowlistConfigured,
        routeMatched: params.channelAllowed,
    }).allowed;
}
