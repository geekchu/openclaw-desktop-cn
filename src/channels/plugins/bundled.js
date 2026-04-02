import { GENERATED_BUNDLED_CHANNEL_ENTRIES } from "../../generated/bundled-channel-entries.generated.js";
function isGeneratedBundledChannelEntry(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value;
    return typeof record.id === "string" && typeof record.entry?.channelPlugin?.id === "string";
}
const generatedBundledChannelEntries = (Array.isArray(GENERATED_BUNDLED_CHANNEL_ENTRIES)
    ? GENERATED_BUNDLED_CHANNEL_ENTRIES.filter(isGeneratedBundledChannelEntry)
    : []);
export const bundledChannelPlugins = generatedBundledChannelEntries.map(({ entry }) => entry.channelPlugin);
export const bundledChannelSetupPlugins = generatedBundledChannelEntries.flatMap(({ setupEntry }) => {
    const plugin = setupEntry?.plugin;
    return plugin ? [plugin] : [];
});
function buildBundledChannelPluginsById(plugins) {
    const byId = new Map();
    for (const plugin of plugins) {
        if (byId.has(plugin.id)) {
            throw new Error(`duplicate bundled channel plugin id: ${plugin.id}`);
        }
        byId.set(plugin.id, plugin);
    }
    return byId;
}
const bundledChannelPluginsById = buildBundledChannelPluginsById(bundledChannelPlugins);
const bundledChannelRuntimeSettersById = new Map();
for (const { entry } of generatedBundledChannelEntries) {
    if (entry.setChannelRuntime) {
        bundledChannelRuntimeSettersById.set(entry.channelPlugin.id, entry.setChannelRuntime);
    }
}
export function getBundledChannelPlugin(id) {
    return bundledChannelPluginsById.get(id);
}
export function requireBundledChannelPlugin(id) {
    const plugin = getBundledChannelPlugin(id);
    if (!plugin) {
        throw new Error(`missing bundled channel plugin: ${id}`);
    }
    return plugin;
}
export function setBundledChannelRuntime(id, runtime) {
    const setter = bundledChannelRuntimeSettersById.get(id);
    if (!setter) {
        throw new Error(`missing bundled channel runtime setter: ${id}`);
    }
    setter(runtime);
}
