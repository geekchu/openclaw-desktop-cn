import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { withBundledPluginAllowlistCompat, withBundledPluginEnablementCompat, } from "./bundled-compat.js";
import { loadOpenClawPlugins } from "./loader.js";
import { createPluginLoaderLogger } from "./logger.js";
import { resolveEnabledProviderPluginIds, resolveBundledProviderCompatPluginIds, withBundledProviderVitestCompat, } from "./providers.js";
const log = createSubsystemLogger("plugins");
export function resolvePluginProviders(params) {
    const env = params.env ?? process.env;
    const autoEnabledConfig = params.config !== undefined
        ? applyPluginAutoEnable({
            config: params.config,
            env,
        }).config
        : undefined;
    const bundledProviderCompatPluginIds = params.bundledProviderAllowlistCompat || params.bundledProviderVitestCompat
        ? resolveBundledProviderCompatPluginIds({
            config: autoEnabledConfig,
            workspaceDir: params.workspaceDir,
            env,
            onlyPluginIds: params.onlyPluginIds,
        })
        : [];
    const maybeAllowlistCompat = params.bundledProviderAllowlistCompat
        ? withBundledPluginAllowlistCompat({
            config: autoEnabledConfig,
            pluginIds: bundledProviderCompatPluginIds,
        })
        : autoEnabledConfig;
    const allowlistCompatConfig = params.bundledProviderAllowlistCompat
        ? withBundledPluginEnablementCompat({
            config: maybeAllowlistCompat,
            pluginIds: bundledProviderCompatPluginIds,
        })
        : maybeAllowlistCompat;
    const config = params.bundledProviderVitestCompat
        ? withBundledProviderVitestCompat({
            config: allowlistCompatConfig,
            pluginIds: bundledProviderCompatPluginIds,
            env,
        })
        : allowlistCompatConfig;
    const providerPluginIds = resolveEnabledProviderPluginIds({
        config,
        workspaceDir: params.workspaceDir,
        env,
        onlyPluginIds: params.onlyPluginIds,
    });
    const registry = loadOpenClawPlugins({
        config,
        workspaceDir: params.workspaceDir,
        env,
        onlyPluginIds: providerPluginIds,
        pluginSdkResolution: params.pluginSdkResolution,
        cache: params.cache ?? false,
        activate: params.activate ?? false,
        logger: createPluginLoaderLogger(log),
    });
    return registry.providers.map((entry) => ({
        ...entry.provider,
        pluginId: entry.pluginId,
    }));
}
