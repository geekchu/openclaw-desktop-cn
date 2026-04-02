import { listSlackDirectoryGroupsLive as listSlackDirectoryGroupsLiveImpl, listSlackDirectoryPeersLive as listSlackDirectoryPeersLiveImpl, monitorSlackProvider as monitorSlackProviderImpl, probeSlack as probeSlackImpl, resolveSlackChannelAllowlist as resolveSlackChannelAllowlistImpl, resolveSlackUserAllowlist as resolveSlackUserAllowlistImpl, sendMessageSlack as sendMessageSlackImpl, handleSlackAction as handleSlackActionImpl, } from "../../plugin-sdk/slack.js";
export const runtimeSlackOps = {
    listDirectoryGroupsLive: listSlackDirectoryGroupsLiveImpl,
    listDirectoryPeersLive: listSlackDirectoryPeersLiveImpl,
    probeSlack: probeSlackImpl,
    resolveChannelAllowlist: resolveSlackChannelAllowlistImpl,
    resolveUserAllowlist: resolveSlackUserAllowlistImpl,
    sendMessageSlack: sendMessageSlackImpl,
    monitorSlackProvider: monitorSlackProviderImpl,
    handleSlackAction: handleSlackActionImpl,
};
