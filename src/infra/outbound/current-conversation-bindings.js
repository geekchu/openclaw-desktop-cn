import fs from "node:fs";
import path from "node:path";
import { normalizeConversationText } from "../../acp/conversation-id.js";
import { bundledChannelPlugins } from "../../channels/plugins/bundled.js";
import { normalizeAnyChannelId } from "../../channels/registry.js";
import { resolveStateDir } from "../../config/paths.js";
import { loadJsonFile } from "../../infra/json-file.js";
import { writeJsonFileAtomically } from "../../plugin-sdk/json-store.js";
import { getActivePluginChannelRegistry } from "../../plugins/runtime.js";
import { normalizeAccountId } from "../../routing/session-key.js";
const CURRENT_BINDINGS_FILE_VERSION = 1;
const CURRENT_BINDINGS_ID_PREFIX = "generic:";
let bindingsLoaded = false;
let persistPromise = Promise.resolve();
const bindingsByConversationKey = new Map();
function normalizeConversationRef(ref) {
    return {
        channel: ref.channel.trim().toLowerCase(),
        accountId: normalizeAccountId(ref.accountId),
        conversationId: ref.conversationId.trim(),
        parentConversationId: ref.parentConversationId?.trim() || undefined,
    };
}
function buildConversationKey(ref) {
    const normalized = normalizeConversationRef(ref);
    return [
        normalized.channel,
        normalized.accountId,
        normalized.parentConversationId ?? "",
        normalized.conversationId,
    ].join("\u241f");
}
function buildBindingId(ref) {
    return `${CURRENT_BINDINGS_ID_PREFIX}${buildConversationKey(ref)}`;
}
function resolveBindingsFilePath(env = process.env) {
    return path.join(resolveStateDir(env), "bindings", "current-conversations.json");
}
function isBindingExpired(record, now = Date.now()) {
    return typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt)
        ? record.expiresAt <= now
        : false;
}
function toPersistedFile() {
    const bindings = [...bindingsByConversationKey.values()]
        .filter((record) => !isBindingExpired(record))
        .toSorted((a, b) => a.bindingId.localeCompare(b.bindingId));
    return {
        version: CURRENT_BINDINGS_FILE_VERSION,
        bindings,
    };
}
function loadBindingsIntoMemory() {
    if (bindingsLoaded) {
        return;
    }
    bindingsLoaded = true;
    bindingsByConversationKey.clear();
    const parsed = loadJsonFile(resolveBindingsFilePath());
    const bindings = parsed?.version === CURRENT_BINDINGS_FILE_VERSION ? parsed.bindings : [];
    for (const record of bindings ?? []) {
        if (!record?.bindingId || !record?.conversation?.conversationId || isBindingExpired(record)) {
            continue;
        }
        bindingsByConversationKey.set(buildConversationKey(record.conversation), {
            ...record,
            conversation: normalizeConversationRef(record.conversation),
        });
    }
}
async function persistBindingsToDisk() {
    await writeJsonFileAtomically(resolveBindingsFilePath(), toPersistedFile());
}
function enqueuePersist() {
    persistPromise = persistPromise
        .catch(() => { })
        .then(async () => {
        await persistBindingsToDisk();
    });
    return persistPromise;
}
function pruneExpiredBinding(key) {
    loadBindingsIntoMemory();
    const record = bindingsByConversationKey.get(key) ?? null;
    if (!record) {
        return null;
    }
    if (!isBindingExpired(record)) {
        return record;
    }
    bindingsByConversationKey.delete(key);
    void enqueuePersist();
    return null;
}
function resolveChannelSupportsCurrentConversationBinding(channel) {
    const normalized = normalizeAnyChannelId(channel) ?? normalizeConversationText(channel)?.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    const matchesPluginId = (plugin) => plugin.id === normalized ||
        (plugin.meta?.aliases ?? []).some((alias) => alias.trim().toLowerCase() === normalized);
    const plugin = getActivePluginChannelRegistry()?.channels.find((entry) => matchesPluginId(entry.plugin))
        ?.plugin ?? bundledChannelPlugins.find((entry) => matchesPluginId(entry));
    return plugin?.conversationBindings?.supportsCurrentConversationBinding === true;
}
export function getGenericCurrentConversationBindingCapabilities(params) {
    void params.accountId;
    if (!resolveChannelSupportsCurrentConversationBinding(params.channel)) {
        return null;
    }
    return {
        adapterAvailable: true,
        bindSupported: true,
        unbindSupported: true,
        placements: ["current"],
    };
}
export async function bindGenericCurrentConversation(input) {
    const conversation = normalizeConversationRef(input.conversation);
    const targetSessionKey = input.targetSessionKey.trim();
    if (!conversation.channel || !conversation.conversationId || !targetSessionKey) {
        return null;
    }
    loadBindingsIntoMemory();
    const now = Date.now();
    const ttlMs = typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs)
        ? Math.max(0, Math.floor(input.ttlMs))
        : undefined;
    const key = buildConversationKey(conversation);
    const existing = pruneExpiredBinding(key);
    const record = {
        bindingId: buildBindingId(conversation),
        targetSessionKey,
        targetKind: input.targetKind,
        conversation,
        status: "active",
        boundAt: now,
        ...(ttlMs != null ? { expiresAt: now + ttlMs } : {}),
        metadata: {
            ...existing?.metadata,
            ...input.metadata,
            lastActivityAt: now,
        },
    };
    bindingsByConversationKey.set(key, record);
    await enqueuePersist();
    return record;
}
export function resolveGenericCurrentConversationBinding(ref) {
    return pruneExpiredBinding(buildConversationKey(ref));
}
export function listGenericCurrentConversationBindingsBySession(targetSessionKey) {
    loadBindingsIntoMemory();
    const results = [];
    for (const key of bindingsByConversationKey.keys()) {
        const record = pruneExpiredBinding(key);
        if (!record || record.targetSessionKey !== targetSessionKey) {
            continue;
        }
        results.push(record);
    }
    return results;
}
export function touchGenericCurrentConversationBinding(bindingId, at = Date.now()) {
    loadBindingsIntoMemory();
    if (!bindingId.startsWith(CURRENT_BINDINGS_ID_PREFIX)) {
        return;
    }
    const key = bindingId.slice(CURRENT_BINDINGS_ID_PREFIX.length);
    const record = pruneExpiredBinding(key);
    if (!record) {
        return;
    }
    bindingsByConversationKey.set(key, {
        ...record,
        metadata: {
            ...record.metadata,
            lastActivityAt: at,
        },
    });
}
export async function unbindGenericCurrentConversationBindings(input) {
    loadBindingsIntoMemory();
    const removed = [];
    const normalizedBindingId = input.bindingId?.trim();
    const normalizedTargetSessionKey = input.targetSessionKey?.trim();
    if (normalizedBindingId?.startsWith(CURRENT_BINDINGS_ID_PREFIX)) {
        const key = normalizedBindingId.slice(CURRENT_BINDINGS_ID_PREFIX.length);
        const record = pruneExpiredBinding(key);
        if (record) {
            bindingsByConversationKey.delete(key);
            removed.push(record);
            await enqueuePersist();
        }
        return removed;
    }
    if (!normalizedTargetSessionKey) {
        return removed;
    }
    for (const key of bindingsByConversationKey.keys()) {
        const record = pruneExpiredBinding(key);
        if (!record || record.targetSessionKey !== normalizedTargetSessionKey) {
            continue;
        }
        bindingsByConversationKey.delete(key);
        removed.push(record);
    }
    if (removed.length > 0) {
        await enqueuePersist();
    }
    return removed;
}
export const __testing = {
    resetCurrentConversationBindingsForTests(params) {
        bindingsLoaded = false;
        bindingsByConversationKey.clear();
        persistPromise = Promise.resolve();
        if (params?.deletePersistedFile) {
            const filePath = resolveBindingsFilePath(params.env);
            try {
                fs.rmSync(filePath, { force: true });
            }
            catch {
                // ignore test cleanup failures
            }
        }
    },
    resolveBindingsFilePath,
};
