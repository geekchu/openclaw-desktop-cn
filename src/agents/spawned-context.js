import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { resolveAgentWorkspaceDir } from "./agent-scope.js";
function normalizeOptionalText(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
export function normalizeSpawnedRunMetadata(value) {
    return {
        spawnedBy: normalizeOptionalText(value?.spawnedBy),
        groupId: normalizeOptionalText(value?.groupId),
        groupChannel: normalizeOptionalText(value?.groupChannel),
        groupSpace: normalizeOptionalText(value?.groupSpace),
        workspaceDir: normalizeOptionalText(value?.workspaceDir),
    };
}
export function mapToolContextToSpawnedRunMetadata(value) {
    return {
        groupId: normalizeOptionalText(value?.agentGroupId),
        groupChannel: normalizeOptionalText(value?.agentGroupChannel),
        groupSpace: normalizeOptionalText(value?.agentGroupSpace),
        workspaceDir: normalizeOptionalText(value?.workspaceDir),
    };
}
export function resolveSpawnedWorkspaceInheritance(params) {
    const explicit = normalizeOptionalText(params.explicitWorkspaceDir);
    if (explicit) {
        return explicit;
    }
    // For cross-agent spawns, use the target agent's workspace instead of the requester's.
    const agentId = params.targetAgentId ??
        (params.requesterSessionKey
            ? parseAgentSessionKey(params.requesterSessionKey)?.agentId
            : undefined);
    return agentId ? resolveAgentWorkspaceDir(params.config, normalizeAgentId(agentId)) : undefined;
}
export function resolveIngressWorkspaceOverrideForSpawnedRun(metadata) {
    const normalized = normalizeSpawnedRunMetadata(metadata);
    return normalized.spawnedBy ? normalized.workspaceDir : undefined;
}
