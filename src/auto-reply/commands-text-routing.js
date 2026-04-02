import { listChannelPlugins } from "../channels/plugins/index.js";
import { getActivePluginChannelRegistryVersion } from "../plugins/runtime.js";
let cachedNativeCommandSurfaces = null;
let cachedNativeCommandSurfacesVersion = -1;
export function isNativeCommandSurface(surface) {
    const normalized = surface?.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    const registryVersion = getActivePluginChannelRegistryVersion();
    if (!cachedNativeCommandSurfaces || cachedNativeCommandSurfacesVersion !== registryVersion) {
        cachedNativeCommandSurfaces = new Set(listChannelPlugins()
            .filter((plugin) => plugin.capabilities.nativeCommands)
            .map((plugin) => plugin.id));
        cachedNativeCommandSurfacesVersion = registryVersion;
    }
    return cachedNativeCommandSurfaces.has(normalized);
}
export function shouldHandleTextCommands(params) {
    if (params.commandSource === "native") {
        return true;
    }
    if (params.cfg.commands?.text !== false) {
        return true;
    }
    return !isNativeCommandSurface(params.surface);
}
