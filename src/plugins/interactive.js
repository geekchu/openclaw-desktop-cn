import { resolveGlobalDedupeCache } from "../infra/dedupe.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { dispatchDiscordInteractiveHandler, dispatchSlackInteractiveHandler, dispatchTelegramInteractiveHandler, } from "./interactive-dispatch-adapters.js";
const PLUGIN_INTERACTIVE_STATE_KEY = Symbol.for("openclaw.pluginInteractiveState");
const getState = () => resolveGlobalSingleton(PLUGIN_INTERACTIVE_STATE_KEY, () => ({
    interactiveHandlers: new Map(),
    callbackDedupe: resolveGlobalDedupeCache(Symbol.for("openclaw.pluginInteractiveCallbackDedupe"), {
        ttlMs: 5 * 60_000,
        maxSize: 4096,
    }),
}));
const getInteractiveHandlers = () => getState().interactiveHandlers;
const getCallbackDedupe = () => getState().callbackDedupe;
function toRegistryKey(channel, namespace) {
    return `${channel.trim().toLowerCase()}:${namespace.trim()}`;
}
function normalizeNamespace(namespace) {
    return namespace.trim();
}
function validateNamespace(namespace) {
    if (!namespace.trim()) {
        return "Interactive handler namespace cannot be empty";
    }
    if (!/^[A-Za-z0-9._-]+$/.test(namespace.trim())) {
        return "Interactive handler namespace must contain only letters, numbers, dots, underscores, and hyphens";
    }
    return null;
}
function resolveNamespaceMatch(channel, data) {
    const interactiveHandlers = getInteractiveHandlers();
    const trimmedData = data.trim();
    if (!trimmedData) {
        return null;
    }
    const separatorIndex = trimmedData.indexOf(":");
    const namespace = separatorIndex >= 0 ? trimmedData.slice(0, separatorIndex) : normalizeNamespace(trimmedData);
    const registration = interactiveHandlers.get(toRegistryKey(channel, namespace));
    if (!registration) {
        return null;
    }
    return {
        registration,
        namespace,
        payload: separatorIndex >= 0 ? trimmedData.slice(separatorIndex + 1) : "",
    };
}
export function registerPluginInteractiveHandler(pluginId, registration, opts) {
    const interactiveHandlers = getInteractiveHandlers();
    const namespace = normalizeNamespace(registration.namespace);
    const validationError = validateNamespace(namespace);
    if (validationError) {
        return { ok: false, error: validationError };
    }
    const key = toRegistryKey(registration.channel, namespace);
    const existing = interactiveHandlers.get(key);
    if (existing) {
        return {
            ok: false,
            error: `Interactive handler namespace "${namespace}" already registered by plugin "${existing.pluginId}"`,
        };
    }
    if (registration.channel === "telegram") {
        interactiveHandlers.set(key, {
            ...registration,
            namespace,
            channel: "telegram",
            pluginId,
            pluginName: opts?.pluginName,
            pluginRoot: opts?.pluginRoot,
        });
    }
    else if (registration.channel === "slack") {
        interactiveHandlers.set(key, {
            ...registration,
            namespace,
            channel: "slack",
            pluginId,
            pluginName: opts?.pluginName,
            pluginRoot: opts?.pluginRoot,
        });
    }
    else {
        interactiveHandlers.set(key, {
            ...registration,
            namespace,
            channel: "discord",
            pluginId,
            pluginName: opts?.pluginName,
            pluginRoot: opts?.pluginRoot,
        });
    }
    return { ok: true };
}
export function clearPluginInteractiveHandlers() {
    const interactiveHandlers = getInteractiveHandlers();
    const callbackDedupe = getCallbackDedupe();
    interactiveHandlers.clear();
    callbackDedupe.clear();
}
export function clearPluginInteractiveHandlersForPlugin(pluginId) {
    const interactiveHandlers = getInteractiveHandlers();
    for (const [key, value] of interactiveHandlers.entries()) {
        if (value.pluginId === pluginId) {
            interactiveHandlers.delete(key);
        }
    }
}
export async function dispatchPluginInteractiveHandler(params) {
    const callbackDedupe = getCallbackDedupe();
    const match = resolveNamespaceMatch(params.channel, params.data);
    if (!match) {
        return { matched: false, handled: false, duplicate: false };
    }
    const dedupeKey = params.channel === "telegram" ? params.callbackId?.trim() : params.interactionId?.trim();
    if (dedupeKey && callbackDedupe.peek(dedupeKey)) {
        return { matched: true, handled: true, duplicate: true };
    }
    await params.onMatched?.();
    let result;
    if (params.channel === "telegram") {
        result = dispatchTelegramInteractiveHandler({
            registration: match.registration,
            data: params.data,
            namespace: match.namespace,
            payload: match.payload,
            ctx: params.ctx,
            respond: params.respond,
        });
    }
    else if (params.channel === "discord") {
        result = dispatchDiscordInteractiveHandler({
            registration: match.registration,
            data: params.data,
            namespace: match.namespace,
            payload: match.payload,
            ctx: params.ctx,
            respond: params.respond,
        });
    }
    else {
        result = dispatchSlackInteractiveHandler({
            registration: match.registration,
            data: params.data,
            namespace: match.namespace,
            payload: match.payload,
            ctx: params.ctx,
            respond: params.respond,
        });
    }
    const resolved = await result;
    if (dedupeKey) {
        callbackDedupe.check(dedupeKey);
    }
    return {
        matched: true,
        handled: resolved?.handled ?? true,
        duplicate: false,
    };
}
