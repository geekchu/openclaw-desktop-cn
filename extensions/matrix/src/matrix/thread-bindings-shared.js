import { resolveThreadBindingLifecycle } from "openclaw/plugin-sdk/thread-bindings-runtime";
const MANAGERS_BY_ACCOUNT_ID = new Map();
const BINDINGS_BY_ACCOUNT_CONVERSATION = new Map();
export function resolveBindingKey(params) {
    return `${params.accountId}:${params.parentConversationId?.trim() || "-"}:${params.conversationId}`;
}
function toSessionBindingTargetKind(raw) {
    return raw === "subagent" ? "subagent" : "session";
}
export function toMatrixBindingTargetKind(raw) {
    return raw === "subagent" ? "subagent" : "acp";
}
export function resolveEffectiveBindingExpiry(params) {
    return resolveThreadBindingLifecycle(params);
}
export function toSessionBindingRecord(record, defaults) {
    const lifecycle = resolveEffectiveBindingExpiry({
        record,
        defaultIdleTimeoutMs: defaults.idleTimeoutMs,
        defaultMaxAgeMs: defaults.maxAgeMs,
    });
    const idleTimeoutMs = typeof record.idleTimeoutMs === "number" ? record.idleTimeoutMs : defaults.idleTimeoutMs;
    const maxAgeMs = typeof record.maxAgeMs === "number" ? record.maxAgeMs : defaults.maxAgeMs;
    return {
        bindingId: resolveBindingKey(record),
        targetSessionKey: record.targetSessionKey,
        targetKind: toSessionBindingTargetKind(record.targetKind),
        conversation: {
            channel: "matrix",
            accountId: record.accountId,
            conversationId: record.conversationId,
            parentConversationId: record.parentConversationId,
        },
        status: "active",
        boundAt: record.boundAt,
        expiresAt: lifecycle.expiresAt,
        metadata: {
            agentId: record.agentId,
            label: record.label,
            boundBy: record.boundBy,
            lastActivityAt: record.lastActivityAt,
            idleTimeoutMs,
            maxAgeMs,
        },
    };
}
export function setBindingRecord(record) {
    BINDINGS_BY_ACCOUNT_CONVERSATION.set(resolveBindingKey(record), record);
}
export function removeBindingRecord(record) {
    const key = resolveBindingKey(record);
    const removed = BINDINGS_BY_ACCOUNT_CONVERSATION.get(key) ?? null;
    if (removed) {
        BINDINGS_BY_ACCOUNT_CONVERSATION.delete(key);
    }
    return removed;
}
export function listBindingsForAccount(accountId) {
    return [...BINDINGS_BY_ACCOUNT_CONVERSATION.values()].filter((entry) => entry.accountId === accountId);
}
export function getMatrixThreadBindingManagerEntry(accountId) {
    return MANAGERS_BY_ACCOUNT_ID.get(accountId) ?? null;
}
export function setMatrixThreadBindingManagerEntry(accountId, entry) {
    MANAGERS_BY_ACCOUNT_ID.set(accountId, entry);
}
export function deleteMatrixThreadBindingManagerEntry(accountId) {
    MANAGERS_BY_ACCOUNT_ID.delete(accountId);
}
export function getMatrixThreadBindingManager(accountId) {
    return MANAGERS_BY_ACCOUNT_ID.get(accountId)?.manager ?? null;
}
export function setMatrixThreadBindingIdleTimeoutBySessionKey(params) {
    const manager = MANAGERS_BY_ACCOUNT_ID.get(params.accountId)?.manager;
    if (!manager) {
        return [];
    }
    return manager.setIdleTimeoutBySessionKey(params).map((record) => toSessionBindingRecord(record, {
        idleTimeoutMs: manager.getIdleTimeoutMs(),
        maxAgeMs: manager.getMaxAgeMs(),
    }));
}
export function setMatrixThreadBindingMaxAgeBySessionKey(params) {
    const manager = MANAGERS_BY_ACCOUNT_ID.get(params.accountId)?.manager;
    if (!manager) {
        return [];
    }
    return manager.setMaxAgeBySessionKey(params).map((record) => toSessionBindingRecord(record, {
        idleTimeoutMs: manager.getIdleTimeoutMs(),
        maxAgeMs: manager.getMaxAgeMs(),
    }));
}
export function resetMatrixThreadBindingsForTests() {
    for (const { manager } of MANAGERS_BY_ACCOUNT_ID.values()) {
        manager.stop();
    }
    MANAGERS_BY_ACCOUNT_ID.clear();
    BINDINGS_BY_ACCOUNT_CONVERSATION.clear();
}
