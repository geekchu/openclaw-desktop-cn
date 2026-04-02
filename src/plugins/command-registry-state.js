import { resolveGlobalSingleton } from "../shared/global-singleton.js";
const PLUGIN_COMMAND_STATE_KEY = Symbol.for("openclaw.pluginCommandsState");
const getState = () => resolveGlobalSingleton(PLUGIN_COMMAND_STATE_KEY, () => ({
    pluginCommands: new Map(),
    registryLocked: false,
}));
const getPluginCommandMap = () => getState().pluginCommands;
export const pluginCommands = new Proxy(new Map(), {
    get(_target, property) {
        const value = Reflect.get(getPluginCommandMap(), property, getPluginCommandMap());
        return typeof value === "function" ? value.bind(getPluginCommandMap()) : value;
    },
});
export function isPluginCommandRegistryLocked() {
    return getState().registryLocked;
}
export function setPluginCommandRegistryLocked(locked) {
    getState().registryLocked = locked;
}
export function clearPluginCommands() {
    pluginCommands.clear();
}
export function clearPluginCommandsForPlugin(pluginId) {
    for (const [key, cmd] of pluginCommands.entries()) {
        if (cmd.pluginId === pluginId) {
            pluginCommands.delete(key);
        }
    }
}
function resolvePluginNativeName(command, provider) {
    const providerName = provider?.trim().toLowerCase();
    const providerOverride = providerName ? command.nativeNames?.[providerName] : undefined;
    if (typeof providerOverride === "string" && providerOverride.trim()) {
        return providerOverride.trim();
    }
    const defaultOverride = command.nativeNames?.default;
    if (typeof defaultOverride === "string" && defaultOverride.trim()) {
        return defaultOverride.trim();
    }
    return command.name;
}
export function getPluginCommandSpecs(provider) {
    const providerName = provider?.trim().toLowerCase();
    if (providerName && providerName !== "telegram" && providerName !== "discord") {
        return [];
    }
    return Array.from(pluginCommands.values()).map((cmd) => ({
        name: resolvePluginNativeName(cmd, provider),
        description: cmd.description,
        acceptsArgs: cmd.acceptsArgs ?? false,
    }));
}
