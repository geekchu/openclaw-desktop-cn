import { createEmptyPluginRegistry } from "./registry-empty.js";
const REGISTRY_STATE = Symbol.for("openclaw.pluginRegistryState");
const state = (() => {
    const globalState = globalThis;
    if (!globalState[REGISTRY_STATE]) {
        globalState[REGISTRY_STATE] = {
            activeRegistry: null,
            activeVersion: 0,
            httpRoute: {
                registry: null,
                pinned: false,
                version: 0,
            },
            channel: {
                registry: null,
                pinned: false,
                version: 0,
            },
            key: null,
        };
    }
    return globalState[REGISTRY_STATE];
})();
function installSurfaceRegistry(surface, registry, pinned) {
    if (surface.registry === registry && surface.pinned === pinned) {
        return;
    }
    surface.registry = registry;
    surface.pinned = pinned;
    surface.version += 1;
}
function syncTrackedSurface(surface, registry, refreshVersion = false) {
    if (surface.pinned) {
        return;
    }
    if (surface.registry === registry && !surface.pinned) {
        if (refreshVersion) {
            surface.version += 1;
        }
        return;
    }
    installSurfaceRegistry(surface, registry, false);
}
export function setActivePluginRegistry(registry, cacheKey) {
    state.activeRegistry = registry;
    state.activeVersion += 1;
    syncTrackedSurface(state.httpRoute, registry, true);
    syncTrackedSurface(state.channel, registry, true);
    state.key = cacheKey ?? null;
}
export function getActivePluginRegistry() {
    return state.activeRegistry;
}
export function requireActivePluginRegistry() {
    if (!state.activeRegistry) {
        state.activeRegistry = createEmptyPluginRegistry();
        state.activeVersion += 1;
        syncTrackedSurface(state.httpRoute, state.activeRegistry);
        syncTrackedSurface(state.channel, state.activeRegistry);
    }
    return state.activeRegistry;
}
export function pinActivePluginHttpRouteRegistry(registry) {
    installSurfaceRegistry(state.httpRoute, registry, true);
}
export function releasePinnedPluginHttpRouteRegistry(registry) {
    if (registry && state.httpRoute.registry !== registry) {
        return;
    }
    installSurfaceRegistry(state.httpRoute, state.activeRegistry, false);
}
export function getActivePluginHttpRouteRegistry() {
    return state.httpRoute.registry ?? state.activeRegistry;
}
export function getActivePluginHttpRouteRegistryVersion() {
    return state.httpRoute.registry ? state.httpRoute.version : state.activeVersion;
}
export function requireActivePluginHttpRouteRegistry() {
    const existing = getActivePluginHttpRouteRegistry();
    if (existing) {
        return existing;
    }
    const created = requireActivePluginRegistry();
    installSurfaceRegistry(state.httpRoute, created, false);
    return created;
}
export function resolveActivePluginHttpRouteRegistry(fallback) {
    const routeRegistry = getActivePluginHttpRouteRegistry();
    if (!routeRegistry) {
        return fallback;
    }
    const routeCount = routeRegistry.httpRoutes?.length ?? 0;
    const fallbackRouteCount = fallback.httpRoutes?.length ?? 0;
    if (routeCount === 0 && fallbackRouteCount > 0) {
        return fallback;
    }
    return routeRegistry;
}
/** Pin the channel registry so that subsequent `setActivePluginRegistry` calls
 *  do not replace the channel snapshot used by `getChannelPlugin`. Call at
 *  gateway startup after the initial plugin load so that config-schema reads
 *  and other non-primary registry loads cannot evict channel plugins. */
export function pinActivePluginChannelRegistry(registry) {
    installSurfaceRegistry(state.channel, registry, true);
}
export function releasePinnedPluginChannelRegistry(registry) {
    if (registry && state.channel.registry !== registry) {
        return;
    }
    installSurfaceRegistry(state.channel, state.activeRegistry, false);
}
/** Return the registry that should be used for channel plugin resolution.
 *  When pinned, this returns the startup registry regardless of subsequent
 *  `setActivePluginRegistry` calls. */
export function getActivePluginChannelRegistry() {
    return state.channel.registry ?? state.activeRegistry;
}
export function getActivePluginChannelRegistryVersion() {
    return state.channel.registry ? state.channel.version : state.activeVersion;
}
export function requireActivePluginChannelRegistry() {
    const existing = getActivePluginChannelRegistry();
    if (existing) {
        return existing;
    }
    const created = requireActivePluginRegistry();
    installSurfaceRegistry(state.channel, created, false);
    return created;
}
export function getActivePluginRegistryKey() {
    return state.key;
}
export function getActivePluginRegistryVersion() {
    return state.activeVersion;
}
export function resetPluginRuntimeStateForTest() {
    state.activeRegistry = null;
    state.activeVersion += 1;
    installSurfaceRegistry(state.httpRoute, null, false);
    installSurfaceRegistry(state.channel, null, false);
    state.key = null;
}
