import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";
const AGENT_EVENT_STATE_KEY = Symbol.for("openclaw.agentEvents.state");
function getAgentEventState() {
    return resolveGlobalSingleton(AGENT_EVENT_STATE_KEY, () => ({
        seqByRun: new Map(),
        listeners: new Set(),
        runContextById: new Map(),
    }));
}
export function registerAgentRunContext(runId, context) {
    if (!runId) {
        return;
    }
    const state = getAgentEventState();
    const existing = state.runContextById.get(runId);
    if (!existing) {
        state.runContextById.set(runId, { ...context });
        return;
    }
    if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
        existing.sessionKey = context.sessionKey;
    }
    if (context.verboseLevel && existing.verboseLevel !== context.verboseLevel) {
        existing.verboseLevel = context.verboseLevel;
    }
    if (context.isControlUiVisible !== undefined) {
        existing.isControlUiVisible = context.isControlUiVisible;
    }
    if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
        existing.isHeartbeat = context.isHeartbeat;
    }
}
export function getAgentRunContext(runId) {
    return getAgentEventState().runContextById.get(runId);
}
export function clearAgentRunContext(runId) {
    getAgentEventState().runContextById.delete(runId);
}
export function resetAgentRunContextForTest() {
    getAgentEventState().runContextById.clear();
}
export function emitAgentEvent(event) {
    const state = getAgentEventState();
    const nextSeq = (state.seqByRun.get(event.runId) ?? 0) + 1;
    state.seqByRun.set(event.runId, nextSeq);
    const context = state.runContextById.get(event.runId);
    const isControlUiVisible = context?.isControlUiVisible ?? true;
    const eventSessionKey = typeof event.sessionKey === "string" && event.sessionKey.trim() ? event.sessionKey : undefined;
    const sessionKey = isControlUiVisible ? (eventSessionKey ?? context?.sessionKey) : undefined;
    const enriched = {
        ...event,
        sessionKey,
        seq: nextSeq,
        ts: Date.now(),
    };
    notifyListeners(state.listeners, enriched);
}
export function onAgentEvent(listener) {
    const state = getAgentEventState();
    return registerListener(state.listeners, listener);
}
export function resetAgentEventsForTest() {
    const state = getAgentEventState();
    state.seqByRun.clear();
    state.listeners.clear();
    state.runContextById.clear();
}
