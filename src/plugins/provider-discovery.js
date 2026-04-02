import { normalizeProviderId } from "../agents/model-selection.js";
const DISCOVERY_ORDER = ["simple", "profile", "paired", "late"];
let providerRuntimePromise;
function loadProviderRuntime() {
    providerRuntimePromise ??= import("./provider-discovery.runtime.js");
    return providerRuntimePromise;
}
function resolveProviderCatalogHook(provider) {
    return provider.catalog ?? provider.discovery;
}
export async function resolvePluginDiscoveryProviders(params) {
    return (await loadProviderRuntime())
        .resolvePluginDiscoveryProvidersRuntime(params)
        .filter((provider) => resolveProviderCatalogHook(provider));
}
export function groupPluginDiscoveryProvidersByOrder(providers) {
    const grouped = {
        simple: [],
        profile: [],
        paired: [],
        late: [],
    };
    for (const provider of providers) {
        const order = resolveProviderCatalogHook(provider)?.order ?? "late";
        grouped[order].push(provider);
    }
    for (const order of DISCOVERY_ORDER) {
        grouped[order].sort((a, b) => a.label.localeCompare(b.label));
    }
    return grouped;
}
export function normalizePluginDiscoveryResult(params) {
    const result = params.result;
    if (!result) {
        return {};
    }
    if ("provider" in result) {
        return { [normalizeProviderId(params.provider.id)]: result.provider };
    }
    const normalized = {};
    for (const [key, value] of Object.entries(result.providers)) {
        const normalizedKey = normalizeProviderId(key);
        if (!normalizedKey || !value) {
            continue;
        }
        normalized[normalizedKey] = value;
    }
    return normalized;
}
export function runProviderCatalog(params) {
    return resolveProviderCatalogHook(params.provider)?.run({
        config: params.config,
        agentDir: params.agentDir,
        workspaceDir: params.workspaceDir,
        env: params.env,
        resolveProviderApiKey: params.resolveProviderApiKey,
        resolveProviderAuth: params.resolveProviderAuth,
    });
}
