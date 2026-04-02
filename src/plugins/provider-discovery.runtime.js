import { resolvePluginProviders } from "./providers.runtime.js";
export function resolvePluginDiscoveryProvidersRuntime(params) {
    return resolvePluginProviders({
        ...params,
        bundledProviderAllowlistCompat: true,
    });
}
