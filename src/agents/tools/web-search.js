import { resolveBundledWebSearchPluginId } from "../../plugins/bundled-web-search-provider-ids.js";
import { resolveWebSearchDefinition, resolveWebSearchProviderId, } from "../../web-search/runtime.js";
import { jsonResult } from "./common.js";
import { SEARCH_CACHE } from "./web-search-provider-common.js";
export function createWebSearchTool(options) {
    const runtimeProviderId = options?.runtimeWebSearch?.selectedProvider ?? options?.runtimeWebSearch?.providerConfigured;
    const resolved = resolveWebSearchDefinition({
        ...options,
        preferRuntimeProviders: Boolean(runtimeProviderId) && !resolveBundledWebSearchPluginId(runtimeProviderId),
    });
    if (!resolved) {
        return null;
    }
    return {
        label: "Web Search",
        name: "web_search",
        description: resolved.definition.description,
        parameters: resolved.definition.parameters,
        execute: async (_toolCallId, args) => jsonResult(await resolved.definition.execute(args)),
    };
}
export const __testing = {
    SEARCH_CACHE,
    resolveSearchProvider: (search) => resolveWebSearchProviderId({ search }),
};
