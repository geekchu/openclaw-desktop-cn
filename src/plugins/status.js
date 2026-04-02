import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { loadConfig } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { normalizeOpenClawVersionBase } from "../config/version.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveCompatibilityHostVersion } from "../version.js";
import { inspectBundleLspRuntimeSupport } from "./bundle-lsp.js";
import { inspectBundleMcpRuntimeSupport } from "./bundle-mcp.js";
import { withBundledPluginAllowlistCompat, withBundledPluginEnablementCompat, } from "./bundled-compat.js";
import { normalizePluginsConfig } from "./config-state.js";
import { loadOpenClawPlugins } from "./loader.js";
import { createPluginLoaderLogger } from "./logger.js";
import { resolveBundledProviderCompatPluginIds } from "./providers.js";
function buildCompatibilityNoticesForInspect(inspect) {
    const warnings = [];
    if (inspect.usesLegacyBeforeAgentStart) {
        warnings.push({
            pluginId: inspect.plugin.id,
            code: "legacy-before-agent-start",
            severity: "warn",
            message: "still uses legacy before_agent_start; keep regression coverage on this plugin, and prefer before_model_resolve/before_prompt_build for new work.",
        });
    }
    if (inspect.shape === "hook-only") {
        warnings.push({
            pluginId: inspect.plugin.id,
            code: "hook-only",
            severity: "info",
            message: "is hook-only. This remains a supported compatibility path, but it has not migrated to explicit capability registration yet.",
        });
    }
    return warnings;
}
const log = createSubsystemLogger("plugins");
function resolveStatusConfig(config, env) {
    return applyPluginAutoEnable({
        config,
        env: env ?? process.env,
    }).config;
}
function resolveReportedPluginVersion(plugin, env) {
    if (plugin.origin !== "bundled") {
        return plugin.version;
    }
    return (normalizeOpenClawVersionBase(resolveCompatibilityHostVersion(env)) ??
        normalizeOpenClawVersionBase(plugin.version) ??
        plugin.version);
}
export function buildPluginStatusReport(params) {
    const rawConfig = params?.config ?? loadConfig();
    const config = resolveStatusConfig(rawConfig, params?.env);
    const workspaceDir = params?.workspaceDir
        ? params.workspaceDir
        : (resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config)) ??
            resolveDefaultAgentWorkspaceDir());
    // Apply bundled-provider allowlist compat so that `plugins list` and `doctor`
    // report the same loaded/disabled status the gateway uses at runtime.  Without
    // this, bundled provider plugins are incorrectly shown as "disabled" when
    // `plugins.allow` is set because the allowlist check runs before the
    // bundled-default-enable check.  Scoped to bundled providers only (not all
    // bundled plugins) to match the runtime compat surface in providers.runtime.ts.
    const bundledProviderIds = resolveBundledProviderCompatPluginIds({
        config,
        workspaceDir,
        env: params?.env,
    });
    const effectiveConfig = withBundledPluginAllowlistCompat({
        config,
        pluginIds: bundledProviderIds,
    });
    const runtimeCompatConfig = withBundledPluginEnablementCompat({
        config: effectiveConfig,
        pluginIds: bundledProviderIds,
    });
    const registry = loadOpenClawPlugins({
        config: runtimeCompatConfig,
        workspaceDir,
        env: params?.env,
        logger: createPluginLoaderLogger(log),
    });
    return {
        workspaceDir,
        ...registry,
        plugins: registry.plugins.map((plugin) => ({
            ...plugin,
            version: resolveReportedPluginVersion(plugin, params?.env),
        })),
    };
}
function buildCapabilityEntries(plugin) {
    return [
        { kind: "cli-backend", ids: plugin.cliBackendIds ?? [] },
        { kind: "text-inference", ids: plugin.providerIds },
        { kind: "speech", ids: plugin.speechProviderIds },
        { kind: "media-understanding", ids: plugin.mediaUnderstandingProviderIds },
        { kind: "image-generation", ids: plugin.imageGenerationProviderIds },
        { kind: "web-search", ids: plugin.webSearchProviderIds },
        { kind: "channel", ids: plugin.channelIds },
    ].filter((entry) => entry.ids.length > 0);
}
function deriveInspectShape(params) {
    if (params.capabilityCount > 1) {
        return "hybrid-capability";
    }
    if (params.capabilityCount === 1) {
        return "plain-capability";
    }
    const hasOnlyHooks = params.typedHookCount + params.customHookCount > 0 &&
        params.toolCount === 0 &&
        params.commandCount === 0 &&
        params.cliCount === 0 &&
        params.serviceCount === 0 &&
        params.gatewayMethodCount === 0 &&
        params.httpRouteCount === 0;
    if (hasOnlyHooks) {
        return "hook-only";
    }
    return "non-capability";
}
export function buildPluginInspectReport(params) {
    const rawConfig = params.config ?? loadConfig();
    const config = resolveStatusConfig(rawConfig, params.env);
    const report = params.report ??
        buildPluginStatusReport({
            config,
            workspaceDir: params.workspaceDir,
            env: params.env,
        });
    const plugin = report.plugins.find((entry) => entry.id === params.id || entry.name === params.id);
    if (!plugin) {
        return null;
    }
    const capabilities = buildCapabilityEntries(plugin);
    const typedHooks = report.typedHooks
        .filter((entry) => entry.pluginId === plugin.id)
        .map((entry) => ({
        name: entry.hookName,
        priority: entry.priority,
    }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
    const customHooks = report.hooks
        .filter((entry) => entry.pluginId === plugin.id)
        .map((entry) => ({
        name: entry.entry.hook.name,
        events: [...entry.events].toSorted(),
    }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
    const tools = report.tools
        .filter((entry) => entry.pluginId === plugin.id)
        .map((entry) => ({
        names: [...entry.names],
        optional: entry.optional,
    }));
    const diagnostics = report.diagnostics.filter((entry) => entry.pluginId === plugin.id);
    const policyEntry = normalizePluginsConfig(config.plugins).entries[plugin.id];
    const capabilityCount = capabilities.length;
    const shape = deriveInspectShape({
        capabilityCount,
        typedHookCount: typedHooks.length,
        customHookCount: customHooks.length,
        toolCount: tools.length,
        commandCount: plugin.commands.length,
        cliCount: plugin.cliCommands.length,
        serviceCount: plugin.services.length,
        gatewayMethodCount: plugin.gatewayMethods.length,
        httpRouteCount: plugin.httpRoutes,
    });
    // Populate MCP server info for bundle-format plugins with a known rootDir.
    let mcpServers = [];
    if (plugin.format === "bundle" && plugin.bundleFormat && plugin.rootDir) {
        const mcpSupport = inspectBundleMcpRuntimeSupport({
            pluginId: plugin.id,
            rootDir: plugin.rootDir,
            bundleFormat: plugin.bundleFormat,
        });
        mcpServers = [
            ...mcpSupport.supportedServerNames.map((name) => ({
                name,
                hasStdioTransport: true,
            })),
            ...mcpSupport.unsupportedServerNames.map((name) => ({
                name,
                hasStdioTransport: false,
            })),
        ];
    }
    // Populate LSP server info for bundle-format plugins with a known rootDir.
    let lspServers = [];
    if (plugin.format === "bundle" && plugin.bundleFormat && plugin.rootDir) {
        const lspSupport = inspectBundleLspRuntimeSupport({
            pluginId: plugin.id,
            rootDir: plugin.rootDir,
            bundleFormat: plugin.bundleFormat,
        });
        lspServers = [
            ...lspSupport.supportedServerNames.map((name) => ({
                name,
                hasStdioTransport: true,
            })),
            ...lspSupport.unsupportedServerNames.map((name) => ({
                name,
                hasStdioTransport: false,
            })),
        ];
    }
    const usesLegacyBeforeAgentStart = typedHooks.some((entry) => entry.name === "before_agent_start");
    const compatibility = buildCompatibilityNoticesForInspect({
        plugin,
        shape,
        usesLegacyBeforeAgentStart,
    });
    return {
        workspaceDir: report.workspaceDir,
        plugin,
        shape,
        capabilityMode: capabilityCount === 0 ? "none" : capabilityCount === 1 ? "plain" : "hybrid",
        capabilityCount,
        capabilities,
        typedHooks,
        customHooks,
        tools,
        commands: [...plugin.commands],
        cliCommands: [...plugin.cliCommands],
        services: [...plugin.services],
        gatewayMethods: [...plugin.gatewayMethods],
        mcpServers,
        lspServers,
        httpRouteCount: plugin.httpRoutes,
        bundleCapabilities: plugin.bundleCapabilities ?? [],
        diagnostics,
        policy: {
            allowPromptInjection: policyEntry?.hooks?.allowPromptInjection,
            allowModelOverride: policyEntry?.subagent?.allowModelOverride,
            allowedModels: [...(policyEntry?.subagent?.allowedModels ?? [])],
            hasAllowedModelsConfig: policyEntry?.subagent?.hasAllowedModelsConfig === true,
        },
        usesLegacyBeforeAgentStart,
        compatibility,
    };
}
export function buildAllPluginInspectReports(params) {
    const rawConfig = params?.config ?? loadConfig();
    const config = resolveStatusConfig(rawConfig, params?.env);
    const report = params?.report ??
        buildPluginStatusReport({
            config,
            workspaceDir: params?.workspaceDir,
            env: params?.env,
        });
    return report.plugins
        .map((plugin) => buildPluginInspectReport({
        id: plugin.id,
        config,
        report,
    }))
        .filter((entry) => entry !== null);
}
export function buildPluginCompatibilityWarnings(params) {
    return buildPluginCompatibilityNotices(params).map(formatPluginCompatibilityNotice);
}
export function buildPluginCompatibilityNotices(params) {
    return buildAllPluginInspectReports(params).flatMap((inspect) => inspect.compatibility);
}
export function formatPluginCompatibilityNotice(notice) {
    return `${notice.pluginId} ${notice.message}`;
}
export function summarizePluginCompatibility(notices) {
    return {
        noticeCount: notices.length,
        pluginCount: new Set(notices.map((notice) => notice.pluginId)).size,
    };
}
