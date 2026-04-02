import { formatCliCommand } from "openclaw/plugin-sdk/cli-runtime";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/routing";
// WhatsApp shares a live Baileys socket between inbound and outbound runtime
// chunks. Keep this on a direct globalThis symbol lookup; the generic
// singleton helper was previously inlined during code-splitting and split the
// listener state back into per-chunk Maps.
const WHATSAPP_ACTIVE_LISTENER_STATE_KEY = Symbol.for("openclaw.whatsapp.activeListenerState");
const g = globalThis;
if (!g[WHATSAPP_ACTIVE_LISTENER_STATE_KEY]) {
    g[WHATSAPP_ACTIVE_LISTENER_STATE_KEY] = {
        listeners: new Map(),
        current: null,
    };
}
const state = g[WHATSAPP_ACTIVE_LISTENER_STATE_KEY];
function setCurrentListener(listener) {
    state.current = listener;
}
export function resolveWebAccountId(accountId) {
    return (accountId ?? "").trim() || DEFAULT_ACCOUNT_ID;
}
export function requireActiveWebListener(accountId) {
    const id = resolveWebAccountId(accountId);
    const listener = state.listeners.get(id) ?? null;
    if (!listener) {
        throw new Error(`No active WhatsApp Web listener (account: ${id}). Start the gateway, then link WhatsApp with: ${formatCliCommand(`openclaw channels login --channel whatsapp --account ${id}`)}.`);
    }
    return { accountId: id, listener };
}
export function setActiveWebListener(accountIdOrListener, maybeListener) {
    const { accountId, listener } = typeof accountIdOrListener === "string"
        ? { accountId: accountIdOrListener, listener: maybeListener ?? null }
        : {
            accountId: DEFAULT_ACCOUNT_ID,
            listener: accountIdOrListener ?? null,
        };
    const id = resolveWebAccountId(accountId);
    if (!listener) {
        state.listeners.delete(id);
    }
    else {
        state.listeners.set(id, listener);
    }
    if (id === DEFAULT_ACCOUNT_ID) {
        setCurrentListener(listener);
    }
}
export function getActiveWebListener(accountId) {
    const id = resolveWebAccountId(accountId);
    return state.listeners.get(id) ?? null;
}
