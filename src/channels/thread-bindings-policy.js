import { normalizeAccountId } from "../routing/session-key.js";
export const DISCORD_THREAD_BINDING_CHANNEL = "discord";
export const MATRIX_THREAD_BINDING_CHANNEL = "matrix";
const DEFAULT_THREAD_BINDING_IDLE_HOURS = 24;
const DEFAULT_THREAD_BINDING_MAX_AGE_HOURS = 0;
function normalizeChannelId(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase();
}
export function supportsAutomaticThreadBindingSpawn(channel) {
    const normalized = normalizeChannelId(channel);
    return (normalized === DISCORD_THREAD_BINDING_CHANNEL || normalized === MATRIX_THREAD_BINDING_CHANNEL);
}
export function requiresNativeThreadContextForThreadHere(channel) {
    const normalized = normalizeChannelId(channel);
    return normalized !== "telegram" && normalized !== "feishu";
}
export function resolveThreadBindingPlacementForCurrentContext(params) {
    if (!requiresNativeThreadContextForThreadHere(params.channel)) {
        return "current";
    }
    return params.threadId ? "current" : "child";
}
function normalizeBoolean(value) {
    if (typeof value !== "boolean") {
        return undefined;
    }
    return value;
}
function normalizeThreadBindingHours(raw) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return undefined;
    }
    if (raw < 0) {
        return undefined;
    }
    return raw;
}
export function resolveThreadBindingIdleTimeoutMs(params) {
    const idleHours = normalizeThreadBindingHours(params.channelIdleHoursRaw) ??
        normalizeThreadBindingHours(params.sessionIdleHoursRaw) ??
        DEFAULT_THREAD_BINDING_IDLE_HOURS;
    return Math.floor(idleHours * 60 * 60 * 1000);
}
export function resolveThreadBindingMaxAgeMs(params) {
    const maxAgeHours = normalizeThreadBindingHours(params.channelMaxAgeHoursRaw) ??
        normalizeThreadBindingHours(params.sessionMaxAgeHoursRaw) ??
        DEFAULT_THREAD_BINDING_MAX_AGE_HOURS;
    return Math.floor(maxAgeHours * 60 * 60 * 1000);
}
export function resolveThreadBindingLifecycle(params) {
    const idleTimeoutMs = typeof params.record.idleTimeoutMs === "number"
        ? Math.max(0, Math.floor(params.record.idleTimeoutMs))
        : params.defaultIdleTimeoutMs;
    const maxAgeMs = typeof params.record.maxAgeMs === "number"
        ? Math.max(0, Math.floor(params.record.maxAgeMs))
        : params.defaultMaxAgeMs;
    const inactivityExpiresAt = idleTimeoutMs > 0
        ? Math.max(params.record.lastActivityAt, params.record.boundAt) + idleTimeoutMs
        : undefined;
    const maxAgeExpiresAt = maxAgeMs > 0 ? params.record.boundAt + maxAgeMs : undefined;
    if (inactivityExpiresAt != null && maxAgeExpiresAt != null) {
        return inactivityExpiresAt <= maxAgeExpiresAt
            ? { expiresAt: inactivityExpiresAt, reason: "idle-expired" }
            : { expiresAt: maxAgeExpiresAt, reason: "max-age-expired" };
    }
    if (inactivityExpiresAt != null) {
        return { expiresAt: inactivityExpiresAt, reason: "idle-expired" };
    }
    if (maxAgeExpiresAt != null) {
        return { expiresAt: maxAgeExpiresAt, reason: "max-age-expired" };
    }
    return {};
}
export function resolveThreadBindingEffectiveExpiresAt(params) {
    return resolveThreadBindingLifecycle(params).expiresAt;
}
export function resolveThreadBindingsEnabled(params) {
    return (normalizeBoolean(params.channelEnabledRaw) ?? normalizeBoolean(params.sessionEnabledRaw) ?? true);
}
function resolveChannelThreadBindings(params) {
    const channels = params.cfg.channels;
    const channelConfig = channels?.[params.channel];
    const accountConfig = channelConfig?.accounts?.[params.accountId];
    return {
        root: channelConfig?.threadBindings,
        account: accountConfig?.threadBindings,
    };
}
function resolveSpawnFlagKey(kind) {
    return kind === "subagent" ? "spawnSubagentSessions" : "spawnAcpSessions";
}
export function resolveThreadBindingSpawnPolicy(params) {
    const channel = normalizeChannelId(params.channel);
    const accountId = normalizeAccountId(params.accountId);
    const { root, account } = resolveChannelThreadBindings({
        cfg: params.cfg,
        channel,
        accountId,
    });
    const enabled = normalizeBoolean(account?.enabled) ??
        normalizeBoolean(root?.enabled) ??
        normalizeBoolean(params.cfg.session?.threadBindings?.enabled) ??
        true;
    const spawnFlagKey = resolveSpawnFlagKey(params.kind);
    const spawnEnabledRaw = normalizeBoolean(account?.[spawnFlagKey]) ?? normalizeBoolean(root?.[spawnFlagKey]);
    const spawnEnabled = spawnEnabledRaw ?? !supportsAutomaticThreadBindingSpawn(channel);
    return {
        channel,
        accountId,
        enabled,
        spawnEnabled,
    };
}
export function resolveThreadBindingIdleTimeoutMsForChannel(params) {
    const { root, account } = resolveThreadBindingChannelScope(params);
    return resolveThreadBindingIdleTimeoutMs({
        channelIdleHoursRaw: account?.idleHours ?? root?.idleHours,
        sessionIdleHoursRaw: params.cfg.session?.threadBindings?.idleHours,
    });
}
export function resolveThreadBindingMaxAgeMsForChannel(params) {
    const { root, account } = resolveThreadBindingChannelScope(params);
    return resolveThreadBindingMaxAgeMs({
        channelMaxAgeHoursRaw: account?.maxAgeHours ?? root?.maxAgeHours,
        sessionMaxAgeHoursRaw: params.cfg.session?.threadBindings?.maxAgeHours,
    });
}
function resolveThreadBindingChannelScope(params) {
    const channel = normalizeChannelId(params.channel);
    const accountId = normalizeAccountId(params.accountId);
    return resolveChannelThreadBindings({
        cfg: params.cfg,
        channel,
        accountId,
    });
}
export function formatThreadBindingDisabledError(params) {
    if (params.channel === DISCORD_THREAD_BINDING_CHANNEL) {
        return "Discord thread bindings are disabled (set channels.discord.threadBindings.enabled=true to override for this account, or session.threadBindings.enabled=true globally).";
    }
    if (params.channel === MATRIX_THREAD_BINDING_CHANNEL) {
        return "Matrix thread bindings are disabled (set channels.matrix.threadBindings.enabled=true to override for this account, or session.threadBindings.enabled=true globally).";
    }
    return `Thread bindings are disabled for ${params.channel} (set session.threadBindings.enabled=true to enable).`;
}
export function formatThreadBindingSpawnDisabledError(params) {
    if (params.channel === DISCORD_THREAD_BINDING_CHANNEL && params.kind === "acp") {
        return "Discord thread-bound ACP spawns are disabled for this account (set channels.discord.threadBindings.spawnAcpSessions=true to enable).";
    }
    if (params.channel === DISCORD_THREAD_BINDING_CHANNEL && params.kind === "subagent") {
        return "Discord thread-bound subagent spawns are disabled for this account (set channels.discord.threadBindings.spawnSubagentSessions=true to enable).";
    }
    if (params.channel === MATRIX_THREAD_BINDING_CHANNEL && params.kind === "acp") {
        return "Matrix thread-bound ACP spawns are disabled for this account (set channels.matrix.threadBindings.spawnAcpSessions=true to enable).";
    }
    if (params.channel === MATRIX_THREAD_BINDING_CHANNEL && params.kind === "subagent") {
        return "Matrix thread-bound subagent spawns are disabled for this account (set channels.matrix.threadBindings.spawnSubagentSessions=true to enable).";
    }
    return `Thread-bound ${params.kind} spawns are disabled for ${params.channel}.`;
}
