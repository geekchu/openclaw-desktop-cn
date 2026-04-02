import { createLazyRuntimeSurface } from "../shared/lazy-runtime.js";
import { createOutboundSendDepsFromCliSource } from "./outbound-send-mapping.js";
// Per-channel module caches for lazy loading.
const senderCache = new Map();
/**
 * Create a lazy-loading send function proxy for a channel.
 * The channel's module is loaded on first call and cached for reuse.
 */
function createLazySender(channelId, loader) {
    const loadRuntimeSend = createLazyRuntimeSurface(loader, ({ runtimeSend }) => runtimeSend);
    return async (...args) => {
        let cached = senderCache.get(channelId);
        if (!cached) {
            cached = loadRuntimeSend();
            senderCache.set(channelId, cached);
        }
        const runtimeSend = await cached;
        return await runtimeSend.sendMessage(...args);
    };
}
export function createDefaultDeps() {
    // Keep the default dependency barrel limited to lazy senders so callers that
    // only need outbound deps do not pull channel runtime boundaries on import.
    return {
        whatsapp: createLazySender("whatsapp", () => import("./send-runtime/whatsapp.js")),
        telegram: createLazySender("telegram", () => import("./send-runtime/telegram.js")),
        discord: createLazySender("discord", () => import("./send-runtime/discord.js")),
        slack: createLazySender("slack", () => import("./send-runtime/slack.js")),
        signal: createLazySender("signal", () => import("./send-runtime/signal.js")),
        imessage: createLazySender("imessage", () => import("./send-runtime/imessage.js")),
    };
}
export function createOutboundSendDeps(deps) {
    return createOutboundSendDepsFromCliSource(deps);
}
