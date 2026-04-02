import { listChannelPlugins } from "../channels/plugins/index.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
import { assertCommandRegistry, buildBuiltinChatCommands, defineChatCommand, } from "./commands-registry.shared.js";
function defineDockCommand(plugin) {
    return defineChatCommand({
        key: `dock:${plugin.id}`,
        nativeName: `dock_${plugin.id}`,
        description: `Switch to ${plugin.id} for replies.`,
        textAliases: [`/dock-${plugin.id}`, `/dock_${plugin.id}`],
        category: "docks",
    });
}
let cachedCommands = null;
let cachedRegistry = null;
let cachedNativeCommandSurfaces = null;
let cachedNativeRegistry = null;
function buildChatCommands() {
    const commands = [
        ...buildBuiltinChatCommands(),
        ...listChannelPlugins()
            .filter((plugin) => plugin.capabilities.nativeCommands)
            .map((plugin) => defineDockCommand(plugin)),
    ];
    assertCommandRegistry(commands);
    return commands;
}
export function getChatCommands() {
    const registry = getActivePluginRegistry();
    if (cachedCommands && registry === cachedRegistry) {
        return cachedCommands;
    }
    const commands = buildChatCommands();
    cachedCommands = commands;
    cachedRegistry = registry;
    cachedNativeCommandSurfaces = null;
    return commands;
}
export function getNativeCommandSurfaces() {
    const registry = getActivePluginRegistry();
    if (cachedNativeCommandSurfaces && registry === cachedNativeRegistry) {
        return cachedNativeCommandSurfaces;
    }
    cachedNativeCommandSurfaces = new Set(listChannelPlugins()
        .filter((plugin) => plugin.capabilities.nativeCommands)
        .map((plugin) => plugin.id));
    cachedNativeRegistry = registry;
    return cachedNativeCommandSurfaces;
}
