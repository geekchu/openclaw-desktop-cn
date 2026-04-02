import { normalizeAgentId, normalizeMainKey, resolveAgentIdFromSessionKey, } from "../../routing/session-key.js";
const FALLBACK_DEFAULT_AGENT_ID = "main";
function buildMainSessionKey(agentId, mainKey) {
    return `agent:${normalizeAgentId(agentId)}:${normalizeMainKey(mainKey)}`;
}
export function resolveMainSessionKey(cfg) {
    if (cfg?.session?.scope === "global") {
        return "global";
    }
    const agents = cfg?.agents?.list ?? [];
    const defaultAgentId = agents.find((agent) => agent?.default)?.id ?? agents[0]?.id ?? FALLBACK_DEFAULT_AGENT_ID;
    return buildMainSessionKey(defaultAgentId, cfg?.session?.mainKey);
}
export { resolveAgentIdFromSessionKey };
export function resolveAgentMainSessionKey(params) {
    return buildMainSessionKey(params.agentId, params.cfg?.session?.mainKey);
}
export function resolveExplicitAgentSessionKey(params) {
    const agentId = params.agentId?.trim();
    if (!agentId) {
        return undefined;
    }
    return resolveAgentMainSessionKey({ cfg: params.cfg, agentId });
}
export function canonicalizeMainSessionAlias(params) {
    const raw = params.sessionKey.trim();
    if (!raw) {
        return raw;
    }
    const agentId = normalizeAgentId(params.agentId);
    const mainKey = normalizeMainKey(params.cfg?.session?.mainKey);
    const agentMainSessionKey = buildMainSessionKey(agentId, mainKey);
    const agentMainAliasKey = buildMainSessionKey(agentId, "main");
    const isMainAlias = raw === "main" || raw === mainKey || raw === agentMainSessionKey || raw === agentMainAliasKey;
    if (params.cfg?.session?.scope === "global" && isMainAlias) {
        return "global";
    }
    if (isMainAlias) {
        return agentMainSessionKey;
    }
    return raw;
}
