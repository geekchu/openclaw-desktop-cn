import * as bundledChannelModule from "../channels/plugins/bundled.js";
import { buildChannelConfigSchema } from "../channels/plugins/config-schema.js";
import { BUNDLED_PLUGIN_METADATA } from "../plugins/bundled-plugin-metadata.js";
import { MSTeamsConfigSchema } from "./zod-schema.providers-core.js";
import { WhatsAppConfigSchema } from "./zod-schema.providers-whatsapp.js";
const staticBundledChannelSchemas = new Map([
    ["msteams", buildChannelConfigSchema(MSTeamsConfigSchema)],
    ["whatsapp", buildChannelConfigSchema(WhatsAppConfigSchema)],
]);
let cachedBundledChannelMaps;
function buildBundledChannelMaps(plugins) {
    const runtimeMap = new Map();
    const configSchemaMap = new Map();
    for (const plugin of plugins) {
        const channelSchema = plugin.configSchema;
        if (!channelSchema) {
            continue;
        }
        configSchemaMap.set(plugin.id, channelSchema);
        if (channelSchema.runtime) {
            runtimeMap.set(plugin.id, channelSchema.runtime);
        }
    }
    for (const entry of BUNDLED_PLUGIN_METADATA) {
        const channelConfigs = entry.manifest.channelConfigs;
        if (!channelConfigs) {
            continue;
        }
        for (const [channelId, channelConfig] of Object.entries(channelConfigs)) {
            const channelSchema = channelConfig?.schema;
            if (!channelSchema) {
                continue;
            }
            if (!configSchemaMap.has(channelId)) {
                configSchemaMap.set(channelId, { schema: channelSchema });
            }
        }
    }
    for (const [channelId, channelSchema] of staticBundledChannelSchemas) {
        if (!configSchemaMap.has(channelId)) {
            configSchemaMap.set(channelId, channelSchema);
        }
        if (channelSchema.runtime && !runtimeMap.has(channelId)) {
            runtimeMap.set(channelId, channelSchema.runtime);
        }
    }
    return { runtimeMap, configSchemaMap };
}
function readBundledChannelPlugins() {
    try {
        return Array.isArray(bundledChannelModule.bundledChannelPlugins)
            ? bundledChannelModule.bundledChannelPlugins
            : undefined;
    }
    catch (error) {
        // Circular bundled channel imports can transiently hit TDZ during test/bootstrap
        // initialization. Fall back to metadata/static schemas until the registry is ready.
        if (error instanceof ReferenceError) {
            return undefined;
        }
        throw error;
    }
}
function getBundledChannelMaps() {
    const plugins = readBundledChannelPlugins();
    if (plugins && cachedBundledChannelMaps) {
        return cachedBundledChannelMaps;
    }
    const maps = buildBundledChannelMaps(plugins ?? []);
    // Tests and some import cycles can temporarily expose an incomplete bundled list.
    // Only cache once the exported plugin array is actually available.
    if (plugins) {
        cachedBundledChannelMaps = maps;
    }
    return maps;
}
export function getBundledChannelRuntimeMap() {
    return getBundledChannelMaps().runtimeMap;
}
export function getBundledChannelConfigSchemaMap() {
    return getBundledChannelMaps().configSchemaMap;
}
