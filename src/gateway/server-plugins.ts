import type { loadConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "./server-methods/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { loadOpenClawPlugins, loadOpenClawPluginsAsync } from "../plugins/loader.js";

type PluginLoadParams = {
  cfg: ReturnType<typeof loadConfig>;
  workspaceDir: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  coreGatewayHandlers: Record<string, GatewayRequestHandler>;
  baseMethods: string[];
};

function logDiagnostics(
  registry: PluginRegistry,
  log: PluginLoadParams["log"],
) {
  for (const diag of registry.diagnostics) {
    const details = [
      diag.pluginId ? `plugin=${diag.pluginId}` : null,
      diag.source ? `source=${diag.source}` : null,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(", ");
    const message = details
      ? `[plugins] ${diag.message} (${details})`
      : `[plugins] ${diag.message}`;
    if (diag.level === "error") {
      log.error(message);
    } else {
      log.info(message);
    }
  }
}

export async function loadGatewayPluginsAsync(params: PluginLoadParams) {
  const pluginRegistry = await loadOpenClawPluginsAsync({
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    logger: {
      info: (msg) => params.log.info(msg),
      warn: (msg) => params.log.warn(msg),
      error: (msg) => params.log.error(msg),
      debug: (msg) => params.log.debug(msg),
    },
    coreGatewayHandlers: params.coreGatewayHandlers,
  });
  const pluginMethods = Object.keys(pluginRegistry.gatewayHandlers);
  const gatewayMethods = Array.from(new Set([...params.baseMethods, ...pluginMethods]));
  logDiagnostics(pluginRegistry, params.log);
  return { pluginRegistry, gatewayMethods };
}

/**
 * Load only core (non-channel) plugins synchronously.
 * Channel plugins are excluded so they can be loaded lazily after the HTTP port is bound.
 */
export async function loadGatewayCorePluginsAsync(params: PluginLoadParams) {
  const pluginRegistry = await loadOpenClawPluginsAsync({
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    logger: {
      info: (msg) => params.log.info(msg),
      warn: (msg) => params.log.warn(msg),
      error: (msg) => params.log.error(msg),
      debug: (msg) => params.log.debug(msg),
    },
    coreGatewayHandlers: params.coreGatewayHandlers,
    candidateFilter: (_candidate, manifest) => {
      // Exclude plugins that declare channels — those are loaded lazily
      return !manifest.channels || manifest.channels.length === 0;
    },
  });
  const pluginMethods = Object.keys(pluginRegistry.gatewayHandlers);
  const gatewayMethods = Array.from(new Set([...params.baseMethods, ...pluginMethods]));
  logDiagnostics(pluginRegistry, params.log);
  return { pluginRegistry, gatewayMethods };
}

/**
 * Load only channel plugins asynchronously (lazy phase).
 * Returns a partial registry that should be merged into the main one.
 */
export async function loadGatewayChannelPluginsAsync(params: PluginLoadParams) {
  const pluginRegistry = await loadOpenClawPluginsAsync({
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    logger: {
      info: (msg) => params.log.info(msg),
      warn: (msg) => params.log.warn(msg),
      error: (msg) => params.log.error(msg),
      debug: (msg) => params.log.debug(msg),
    },
    coreGatewayHandlers: params.coreGatewayHandlers,
    candidateFilter: (_candidate, manifest) => {
      // Only load plugins that declare channels
      return Array.isArray(manifest.channels) && manifest.channels.length > 0;
    },
  });
  const pluginMethods = Object.keys(pluginRegistry.gatewayHandlers);
  const gatewayMethods = Array.from(new Set([...params.baseMethods, ...pluginMethods]));
  logDiagnostics(pluginRegistry, params.log);
  return { pluginRegistry, gatewayMethods };
}

/**
 * Merge a partial plugin registry (e.g. channel plugins) into the main registry.
 */
export function mergePluginRegistry(
  target: PluginRegistry,
  source: PluginRegistry,
): void {
  target.plugins.push(...source.plugins);
  target.tools.push(...source.tools);
  target.hooks.push(...source.hooks);
  target.typedHooks.push(...source.typedHooks);
  target.channels.push(...source.channels);
  target.providers.push(...source.providers);
  for (const [method, handler] of Object.entries(source.gatewayHandlers)) {
    if (!(method in target.gatewayHandlers)) {
      target.gatewayHandlers[method] = handler;
    }
  }
  target.httpHandlers.push(...source.httpHandlers);
  target.httpRoutes.push(...source.httpRoutes);
  target.cliRegistrars.push(...source.cliRegistrars);
  target.services.push(...source.services);
  target.commands.push(...source.commands);
  target.diagnostics.push(...source.diagnostics);
}

export function loadGatewayPlugins(params: PluginLoadParams) {
  const pluginRegistry = loadOpenClawPlugins({
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    logger: {
      info: (msg) => params.log.info(msg),
      warn: (msg) => params.log.warn(msg),
      error: (msg) => params.log.error(msg),
      debug: (msg) => params.log.debug(msg),
    },
    coreGatewayHandlers: params.coreGatewayHandlers,
  });
  const pluginMethods = Object.keys(pluginRegistry.gatewayHandlers);
  const gatewayMethods = Array.from(new Set([...params.baseMethods, ...pluginMethods]));
  logDiagnostics(pluginRegistry, params.log);
  return { pluginRegistry, gatewayMethods };
}
