import { DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH } from "../config/agent-limits.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { isSubagentSessionKey, parseAgentSessionKey } from "../routing/session-key.js";
import { getSubagentDepthFromSessionStore } from "./subagent-depth.js";
export const SUBAGENT_SESSION_ROLES = ["main", "orchestrator", "leaf"];
export const SUBAGENT_CONTROL_SCOPES = ["children", "none"];
function normalizeSessionKey(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function normalizeSubagentRole(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim().toLowerCase();
    return SUBAGENT_SESSION_ROLES.find((entry) => entry === trimmed);
}
function normalizeSubagentControlScope(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim().toLowerCase();
    return SUBAGENT_CONTROL_SCOPES.find((entry) => entry === trimmed);
}
function readSessionStore(storePath) {
    try {
        return loadSessionStore(storePath);
    }
    catch {
        return {};
    }
}
function findEntryBySessionId(store, sessionId) {
    const normalizedSessionId = normalizeSessionKey(sessionId);
    if (!normalizedSessionId) {
        return undefined;
    }
    for (const entry of Object.values(store)) {
        const candidateSessionId = normalizeSessionKey(entry?.sessionId);
        if (candidateSessionId === normalizedSessionId) {
            return entry;
        }
    }
    return undefined;
}
function resolveSessionCapabilityEntry(params) {
    if (params.store) {
        return params.store[params.sessionKey] ?? findEntryBySessionId(params.store, params.sessionKey);
    }
    if (!params.cfg) {
        return undefined;
    }
    const parsed = parseAgentSessionKey(params.sessionKey);
    if (!parsed?.agentId) {
        return undefined;
    }
    const storePath = resolveStorePath(params.cfg.session?.store, { agentId: parsed.agentId });
    const store = readSessionStore(storePath);
    return store[params.sessionKey] ?? findEntryBySessionId(store, params.sessionKey);
}
export function resolveSubagentRoleForDepth(params) {
    const depth = Number.isInteger(params.depth) ? Math.max(0, params.depth) : 0;
    const maxSpawnDepth = typeof params.maxSpawnDepth === "number" && Number.isFinite(params.maxSpawnDepth)
        ? Math.max(1, Math.floor(params.maxSpawnDepth))
        : DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH;
    if (depth <= 0) {
        return "main";
    }
    return depth < maxSpawnDepth ? "orchestrator" : "leaf";
}
export function resolveSubagentControlScopeForRole(role) {
    return role === "leaf" ? "none" : "children";
}
export function resolveSubagentCapabilities(params) {
    const role = resolveSubagentRoleForDepth(params);
    const controlScope = resolveSubagentControlScopeForRole(role);
    return {
        depth: Math.max(0, Math.floor(params.depth)),
        role,
        controlScope,
        canSpawn: role === "main" || role === "orchestrator",
        canControlChildren: controlScope === "children",
    };
}
export function resolveStoredSubagentCapabilities(sessionKey, opts) {
    const normalizedSessionKey = normalizeSessionKey(sessionKey);
    const maxSpawnDepth = opts?.cfg?.agents?.defaults?.subagents?.maxSpawnDepth ?? DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH;
    const depth = getSubagentDepthFromSessionStore(normalizedSessionKey, {
        cfg: opts?.cfg,
        store: opts?.store,
    });
    if (!normalizedSessionKey || !isSubagentSessionKey(normalizedSessionKey)) {
        return resolveSubagentCapabilities({ depth, maxSpawnDepth });
    }
    const entry = resolveSessionCapabilityEntry({
        sessionKey: normalizedSessionKey,
        cfg: opts?.cfg,
        store: opts?.store,
    });
    const storedRole = normalizeSubagentRole(entry?.subagentRole);
    const storedControlScope = normalizeSubagentControlScope(entry?.subagentControlScope);
    const fallback = resolveSubagentCapabilities({ depth, maxSpawnDepth });
    const role = storedRole ?? fallback.role;
    const controlScope = storedControlScope ?? resolveSubagentControlScopeForRole(role);
    return {
        depth,
        role,
        controlScope,
        canSpawn: role === "main" || role === "orchestrator",
        canControlChildren: controlScope === "children",
    };
}
