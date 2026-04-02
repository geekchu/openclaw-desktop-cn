import { normalizeOptionalAccountId } from "../routing/session-key.js";
import { discoverConfigSecretTargetsByIds, listSecretTargetRegistryEntries, } from "../secrets/target-registry.js";
function idsByPrefix(prefixes) {
    return listSecretTargetRegistryEntries()
        .map((entry) => entry.id)
        .filter((id) => prefixes.some((prefix) => id.startsWith(prefix)))
        .toSorted();
}
const COMMAND_SECRET_TARGETS = {
    qrRemote: ["gateway.remote.token", "gateway.remote.password"],
    channels: idsByPrefix(["channels."]),
    models: idsByPrefix(["models.providers."]),
    agentRuntime: idsByPrefix([
        "channels.",
        "models.providers.",
        "agents.defaults.memorySearch.remote.",
        "agents.list[].memorySearch.remote.",
        "skills.entries.",
        "messages.tts.",
        "tools.web.search",
        "tools.web.fetch.firecrawl.",
        "tools.web.x_search",
    ]),
    status: idsByPrefix([
        "channels.",
        "agents.defaults.memorySearch.remote.",
        "agents.list[].memorySearch.remote.",
    ]),
    securityAudit: idsByPrefix(["channels.", "gateway.auth.", "gateway.remote."]),
};
function toTargetIdSet(values) {
    return new Set(values);
}
function normalizeScopedChannelId(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function selectChannelTargetIds(channel) {
    if (!channel) {
        return toTargetIdSet(COMMAND_SECRET_TARGETS.channels);
    }
    return toTargetIdSet(COMMAND_SECRET_TARGETS.channels.filter((id) => id.startsWith(`channels.${channel}.`)));
}
function pathTargetsScopedChannelAccount(params) {
    const [root, channelId, accountRoot, accountId] = params.pathSegments;
    if (root !== "channels" || channelId !== params.channel) {
        return false;
    }
    if (accountRoot !== "accounts") {
        return true;
    }
    return accountId === params.accountId;
}
export function getScopedChannelsCommandSecretTargets(params) {
    const channel = normalizeScopedChannelId(params.channel);
    const targetIds = selectChannelTargetIds(channel);
    const normalizedAccountId = normalizeOptionalAccountId(params.accountId);
    if (!channel || !normalizedAccountId) {
        return { targetIds };
    }
    const allowedPaths = new Set();
    for (const target of discoverConfigSecretTargetsByIds(params.config, targetIds)) {
        if (pathTargetsScopedChannelAccount({
            pathSegments: target.pathSegments,
            channel,
            accountId: normalizedAccountId,
        })) {
            allowedPaths.add(target.path);
        }
    }
    return { targetIds, allowedPaths };
}
export function getQrRemoteCommandSecretTargetIds() {
    return toTargetIdSet(COMMAND_SECRET_TARGETS.qrRemote);
}
export function getChannelsCommandSecretTargetIds() {
    return toTargetIdSet(COMMAND_SECRET_TARGETS.channels);
}
export function getModelsCommandSecretTargetIds() {
    return toTargetIdSet(COMMAND_SECRET_TARGETS.models);
}
export function getAgentRuntimeCommandSecretTargetIds() {
    return toTargetIdSet(COMMAND_SECRET_TARGETS.agentRuntime);
}
export function getStatusCommandSecretTargetIds() {
    return toTargetIdSet(COMMAND_SECRET_TARGETS.status);
}
export function getSecurityAuditCommandSecretTargetIds() {
    return toTargetIdSet(COMMAND_SECRET_TARGETS.securityAudit);
}
