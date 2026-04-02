import path from "node:path";
import { registerContextEngineForOwner } from "../context-engine/registry.js";
import { registerInternalHook } from "../hooks/internal-hooks.js";
import { resolveUserPath } from "../utils.js";
import { buildPluginApi } from "./api-builder.js";
import { registerPluginCommand, validatePluginCommandDefinition } from "./command-registration.js";
import { normalizePluginHttpPath } from "./http-path.js";
import { findOverlappingPluginHttpRoute } from "./http-route-overlap.js";
import { registerPluginInteractiveHandler } from "./interactive.js";
import { getRegisteredMemoryEmbeddingProvider, registerMemoryEmbeddingProvider, } from "./memory-embedding-providers.js";
import { registerMemoryFlushPlanResolver, registerMemoryPromptSection, registerMemoryRuntime, } from "./memory-state.js";
import { normalizeRegisteredProvider } from "./provider-validation.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import { withPluginRuntimePluginIdScope } from "./runtime/gateway-request-scope.js";
import { defaultSlotIdForKey } from "./slots.js";
import { isPluginHookName, isPromptInjectionHookName, stripPromptMutationFieldsFromLegacyHookResult, } from "./types.js";
const constrainLegacyPromptInjectionHook = (handler) => {
    return (event, ctx) => {
        const result = handler(event, ctx);
        if (result && typeof result === "object" && "then" in result) {
            return Promise.resolve(result).then((resolved) => stripPromptMutationFieldsFromLegacyHookResult(resolved));
        }
        return stripPromptMutationFieldsFromLegacyHookResult(result);
    };
};
export { createEmptyPluginRegistry } from "./registry-empty.js";
export function createPluginRegistry(registryParams) {
    const registry = createEmptyPluginRegistry();
    const coreGatewayMethods = new Set(Object.keys(registryParams.coreGatewayHandlers ?? {}));
    const pushDiagnostic = (diag) => {
        registry.diagnostics.push(diag);
    };
    const registerTool = (record, tool, opts) => {
        const names = opts?.names ?? (opts?.name ? [opts.name] : []);
        const optional = opts?.optional === true;
        const factory = typeof tool === "function" ? tool : (_ctx) => tool;
        if (typeof tool !== "function") {
            names.push(tool.name);
        }
        const normalized = names.map((name) => name.trim()).filter(Boolean);
        if (normalized.length > 0) {
            record.toolNames.push(...normalized);
        }
        registry.tools.push({
            pluginId: record.id,
            pluginName: record.name,
            factory,
            names: normalized,
            optional,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const registerHook = (record, events, handler, opts, config) => {
        const eventList = Array.isArray(events) ? events : [events];
        const normalizedEvents = eventList.map((event) => event.trim()).filter(Boolean);
        const entry = opts?.entry ?? null;
        const name = entry?.hook.name ?? opts?.name?.trim();
        if (!name) {
            pushDiagnostic({
                level: "warn",
                pluginId: record.id,
                source: record.source,
                message: "hook registration missing name",
            });
            return;
        }
        const existingHook = registry.hooks.find((entry) => entry.entry.hook.name === name);
        if (existingHook) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `hook already registered: ${name} (${existingHook.pluginId})`,
            });
            return;
        }
        const description = entry?.hook.description ?? opts?.description ?? "";
        const hookEntry = entry
            ? {
                ...entry,
                hook: {
                    ...entry.hook,
                    name,
                    description,
                    source: "openclaw-plugin",
                    pluginId: record.id,
                },
                metadata: {
                    ...entry.metadata,
                    events: normalizedEvents,
                },
            }
            : {
                hook: {
                    name,
                    description,
                    source: "openclaw-plugin",
                    pluginId: record.id,
                    filePath: record.source,
                    baseDir: path.dirname(record.source),
                    handlerPath: record.source,
                },
                frontmatter: {},
                metadata: { events: normalizedEvents },
                invocation: { enabled: true },
            };
        record.hookNames.push(name);
        registry.hooks.push({
            pluginId: record.id,
            entry: hookEntry,
            events: normalizedEvents,
            source: record.source,
        });
        const hookSystemEnabled = config?.hooks?.internal?.enabled === true;
        if (!hookSystemEnabled || opts?.register === false) {
            return;
        }
        for (const event of normalizedEvents) {
            registerInternalHook(event, handler);
        }
    };
    const registerGatewayMethod = (record, method, handler, opts) => {
        const trimmed = method.trim();
        if (!trimmed) {
            return;
        }
        if (coreGatewayMethods.has(trimmed) || registry.gatewayHandlers[trimmed]) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `gateway method already registered: ${trimmed}`,
            });
            return;
        }
        registry.gatewayHandlers[trimmed] = handler;
        if (opts?.scope) {
            registry.gatewayMethodScopes ??= {};
            registry.gatewayMethodScopes[trimmed] = opts.scope;
        }
        record.gatewayMethods.push(trimmed);
    };
    const describeHttpRouteOwner = (entry) => {
        const plugin = entry.pluginId?.trim() || "unknown-plugin";
        const source = entry.source?.trim() || "unknown-source";
        return `${plugin} (${source})`;
    };
    const registerHttpRoute = (record, params) => {
        const normalizedPath = normalizePluginHttpPath(params.path);
        if (!normalizedPath) {
            pushDiagnostic({
                level: "warn",
                pluginId: record.id,
                source: record.source,
                message: "http route registration missing path",
            });
            return;
        }
        if (params.auth !== "gateway" && params.auth !== "plugin") {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `http route registration missing or invalid auth: ${normalizedPath}`,
            });
            return;
        }
        const match = params.match ?? "exact";
        const overlappingRoute = findOverlappingPluginHttpRoute(registry.httpRoutes, {
            path: normalizedPath,
            match,
        });
        if (overlappingRoute && overlappingRoute.auth !== params.auth) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `http route overlap rejected: ${normalizedPath} (${match}, ${params.auth}) ` +
                    `overlaps ${overlappingRoute.path} (${overlappingRoute.match}, ${overlappingRoute.auth}) ` +
                    `owned by ${describeHttpRouteOwner(overlappingRoute)}`,
            });
            return;
        }
        const existingIndex = registry.httpRoutes.findIndex((entry) => entry.path === normalizedPath && entry.match === match);
        if (existingIndex >= 0) {
            const existing = registry.httpRoutes[existingIndex];
            if (!existing) {
                return;
            }
            if (!params.replaceExisting) {
                pushDiagnostic({
                    level: "error",
                    pluginId: record.id,
                    source: record.source,
                    message: `http route already registered: ${normalizedPath} (${match}) by ${describeHttpRouteOwner(existing)}`,
                });
                return;
            }
            if (existing.pluginId && existing.pluginId !== record.id) {
                pushDiagnostic({
                    level: "error",
                    pluginId: record.id,
                    source: record.source,
                    message: `http route replacement rejected: ${normalizedPath} (${match}) owned by ${describeHttpRouteOwner(existing)}`,
                });
                return;
            }
            registry.httpRoutes[existingIndex] = {
                pluginId: record.id,
                path: normalizedPath,
                handler: params.handler,
                auth: params.auth,
                match,
                source: record.source,
            };
            return;
        }
        record.httpRoutes += 1;
        registry.httpRoutes.push({
            pluginId: record.id,
            path: normalizedPath,
            handler: params.handler,
            auth: params.auth,
            match,
            source: record.source,
        });
    };
    const registerChannel = (record, registration, mode = "full") => {
        const normalized = typeof registration.plugin === "object"
            ? registration
            : { plugin: registration };
        const plugin = normalized.plugin;
        const id = typeof plugin?.id === "string" ? plugin.id.trim() : String(plugin?.id ?? "").trim();
        if (!id) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: "channel registration missing id",
            });
            return;
        }
        const existingRuntime = registry.channels.find((entry) => entry.plugin.id === id);
        if (mode !== "setup-only" && existingRuntime) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `channel already registered: ${id} (${existingRuntime.pluginId})`,
            });
            return;
        }
        const existingSetup = registry.channelSetups.find((entry) => entry.plugin.id === id);
        if (existingSetup) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `channel setup already registered: ${id} (${existingSetup.pluginId})`,
            });
            return;
        }
        record.channelIds.push(id);
        registry.channelSetups.push({
            pluginId: record.id,
            pluginName: record.name,
            plugin,
            source: record.source,
            enabled: record.enabled,
            rootDir: record.rootDir,
        });
        if (mode === "setup-only") {
            return;
        }
        registry.channels.push({
            pluginId: record.id,
            pluginName: record.name,
            plugin,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const registerProvider = (record, provider) => {
        const normalizedProvider = normalizeRegisteredProvider({
            pluginId: record.id,
            source: record.source,
            provider,
            pushDiagnostic,
        });
        if (!normalizedProvider) {
            return;
        }
        const id = normalizedProvider.id;
        const existing = registry.providers.find((entry) => entry.provider.id === id);
        if (existing) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `provider already registered: ${id} (${existing.pluginId})`,
            });
            return;
        }
        record.providerIds.push(id);
        registry.providers.push({
            pluginId: record.id,
            pluginName: record.name,
            provider: normalizedProvider,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const registerCliBackend = (record, backend) => {
        const id = backend.id.trim();
        if (!id) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: "cli backend registration missing id",
            });
            return;
        }
        const existing = (registry.cliBackends ?? []).find((entry) => entry.backend.id === id);
        if (existing) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `cli backend already registered: ${id} (${existing.pluginId})`,
            });
            return;
        }
        (registry.cliBackends ??= []).push({
            pluginId: record.id,
            pluginName: record.name,
            backend: {
                ...backend,
                id,
            },
            source: record.source,
            rootDir: record.rootDir,
        });
        record.cliBackendIds.push(id);
    };
    const registerUniqueProviderLike = (params) => {
        const id = params.provider.id.trim();
        const { record, kindLabel } = params;
        const missingLabel = `${kindLabel} registration missing id`;
        const duplicateLabel = `${kindLabel} already registered: ${id}`;
        if (!id) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: missingLabel,
            });
            return;
        }
        const existing = params.registrations.find((entry) => entry.provider.id === id);
        if (existing) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `${duplicateLabel} (${existing.pluginId})`,
            });
            return;
        }
        params.ownedIds.push(id);
        params.registrations.push({
            pluginId: record.id,
            pluginName: record.name,
            provider: params.provider,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const registerSpeechProvider = (record, provider) => {
        registerUniqueProviderLike({
            record,
            provider,
            kindLabel: "speech provider",
            registrations: registry.speechProviders,
            ownedIds: record.speechProviderIds,
        });
    };
    const registerMediaUnderstandingProvider = (record, provider) => {
        registerUniqueProviderLike({
            record,
            provider,
            kindLabel: "media provider",
            registrations: registry.mediaUnderstandingProviders,
            ownedIds: record.mediaUnderstandingProviderIds,
        });
    };
    const registerImageGenerationProvider = (record, provider) => {
        registerUniqueProviderLike({
            record,
            provider,
            kindLabel: "image-generation provider",
            registrations: registry.imageGenerationProviders,
            ownedIds: record.imageGenerationProviderIds,
        });
    };
    const registerWebSearchProvider = (record, provider) => {
        registerUniqueProviderLike({
            record,
            provider,
            kindLabel: "web search provider",
            registrations: registry.webSearchProviders,
            ownedIds: record.webSearchProviderIds,
        });
    };
    const registerCli = (record, registrar, opts) => {
        const descriptors = (opts?.descriptors ?? [])
            .map((descriptor) => ({
            name: descriptor.name.trim(),
            description: descriptor.description.trim(),
            hasSubcommands: descriptor.hasSubcommands,
        }))
            .filter((descriptor) => descriptor.name && descriptor.description);
        const commands = [
            ...(opts?.commands ?? []),
            ...descriptors.map((descriptor) => descriptor.name),
        ]
            .map((cmd) => cmd.trim())
            .filter(Boolean);
        if (commands.length === 0) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: "cli registration missing explicit commands metadata",
            });
            return;
        }
        const existing = registry.cliRegistrars.find((entry) => entry.commands.some((command) => commands.includes(command)));
        if (existing) {
            const overlap = commands.find((command) => existing.commands.includes(command));
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `cli command already registered: ${overlap ?? commands[0]} (${existing.pluginId})`,
            });
            return;
        }
        record.cliCommands.push(...commands);
        registry.cliRegistrars.push({
            pluginId: record.id,
            pluginName: record.name,
            register: registrar,
            commands,
            descriptors,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const registerService = (record, service) => {
        const id = service.id.trim();
        if (!id) {
            return;
        }
        const existing = registry.services.find((entry) => entry.service.id === id);
        if (existing) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: `service already registered: ${id} (${existing.pluginId})`,
            });
            return;
        }
        record.services.push(id);
        registry.services.push({
            pluginId: record.id,
            pluginName: record.name,
            service,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const registerCommand = (record, command) => {
        const name = command.name.trim();
        if (!name) {
            pushDiagnostic({
                level: "error",
                pluginId: record.id,
                source: record.source,
                message: "command registration missing name",
            });
            return;
        }
        // For snapshot (non-activating) loads, record the command locally without touching the
        // global plugin command registry so running gateway commands stay intact.
        // We still validate the command definition so diagnostics match the real activation path.
        // NOTE: cross-plugin duplicate command detection is intentionally skipped here because
        // snapshot registries are isolated and never write to the global command table. Conflicts
        // will surface when the plugin is loaded via the normal activation path at gateway startup.
        if (registryParams.suppressGlobalCommands) {
            const validationError = validatePluginCommandDefinition(command);
            if (validationError) {
                pushDiagnostic({
                    level: "error",
                    pluginId: record.id,
                    source: record.source,
                    message: `command registration failed: ${validationError}`,
                });
                return;
            }
        }
        else {
            const result = registerPluginCommand(record.id, command, {
                pluginName: record.name,
                pluginRoot: record.rootDir,
            });
            if (!result.ok) {
                pushDiagnostic({
                    level: "error",
                    pluginId: record.id,
                    source: record.source,
                    message: `command registration failed: ${result.error}`,
                });
                return;
            }
        }
        record.commands.push(name);
        registry.commands.push({
            pluginId: record.id,
            pluginName: record.name,
            command,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const registerTypedHook = (record, hookName, handler, opts, policy) => {
        if (!isPluginHookName(hookName)) {
            pushDiagnostic({
                level: "warn",
                pluginId: record.id,
                source: record.source,
                message: `unknown typed hook "${String(hookName)}" ignored`,
            });
            return;
        }
        let effectiveHandler = handler;
        if (policy?.allowPromptInjection === false && isPromptInjectionHookName(hookName)) {
            if (hookName === "before_prompt_build") {
                pushDiagnostic({
                    level: "warn",
                    pluginId: record.id,
                    source: record.source,
                    message: `typed hook "${hookName}" blocked by plugins.entries.${record.id}.hooks.allowPromptInjection=false`,
                });
                return;
            }
            if (hookName === "before_agent_start") {
                pushDiagnostic({
                    level: "warn",
                    pluginId: record.id,
                    source: record.source,
                    message: `typed hook "${hookName}" prompt fields constrained by plugins.entries.${record.id}.hooks.allowPromptInjection=false`,
                });
                effectiveHandler = constrainLegacyPromptInjectionHook(handler);
            }
        }
        record.hookCount += 1;
        registry.typedHooks.push({
            pluginId: record.id,
            hookName,
            handler: effectiveHandler,
            priority: opts?.priority,
            source: record.source,
        });
    };
    const registerConversationBindingResolvedHandler = (record, handler) => {
        registry.conversationBindingResolvedHandlers.push({
            pluginId: record.id,
            pluginName: record.name,
            pluginRoot: record.rootDir,
            handler,
            source: record.source,
            rootDir: record.rootDir,
        });
    };
    const normalizeLogger = (logger) => ({
        info: logger.info,
        warn: logger.warn,
        error: logger.error,
        debug: logger.debug,
    });
    const pluginRuntimeById = new Map();
    const resolvePluginRuntime = (pluginId) => {
        const cached = pluginRuntimeById.get(pluginId);
        if (cached) {
            return cached;
        }
        const runtime = new Proxy(registryParams.runtime, {
            get(target, prop, receiver) {
                if (prop !== "subagent") {
                    return Reflect.get(target, prop, receiver);
                }
                const subagent = Reflect.get(target, prop, receiver);
                return {
                    run: (params) => withPluginRuntimePluginIdScope(pluginId, () => subagent.run(params)),
                    waitForRun: (params) => withPluginRuntimePluginIdScope(pluginId, () => subagent.waitForRun(params)),
                    getSessionMessages: (params) => withPluginRuntimePluginIdScope(pluginId, () => subagent.getSessionMessages(params)),
                    getSession: (params) => withPluginRuntimePluginIdScope(pluginId, () => subagent.getSession(params)),
                    deleteSession: (params) => withPluginRuntimePluginIdScope(pluginId, () => subagent.deleteSession(params)),
                };
            },
        });
        pluginRuntimeById.set(pluginId, runtime);
        return runtime;
    };
    const createApi = (record, params) => {
        const registrationMode = params.registrationMode ?? "full";
        return buildPluginApi({
            id: record.id,
            name: record.name,
            version: record.version,
            description: record.description,
            source: record.source,
            rootDir: record.rootDir,
            registrationMode,
            config: params.config,
            pluginConfig: params.pluginConfig,
            runtime: resolvePluginRuntime(record.id),
            logger: normalizeLogger(registryParams.logger),
            resolvePath: (input) => resolveUserPath(input),
            handlers: {
                ...(registrationMode === "full"
                    ? {
                        registerTool: (tool, opts) => registerTool(record, tool, opts),
                        registerHook: (events, handler, opts) => registerHook(record, events, handler, opts, params.config),
                        registerHttpRoute: (routeParams) => registerHttpRoute(record, routeParams),
                        registerProvider: (provider) => registerProvider(record, provider),
                        registerSpeechProvider: (provider) => registerSpeechProvider(record, provider),
                        registerMediaUnderstandingProvider: (provider) => registerMediaUnderstandingProvider(record, provider),
                        registerImageGenerationProvider: (provider) => registerImageGenerationProvider(record, provider),
                        registerWebSearchProvider: (provider) => registerWebSearchProvider(record, provider),
                        registerGatewayMethod: (method, handler, opts) => registerGatewayMethod(record, method, handler, opts),
                        registerCli: (registrar, opts) => registerCli(record, registrar, opts),
                        registerService: (service) => registerService(record, service),
                        registerCliBackend: (backend) => registerCliBackend(record, backend),
                        registerInteractiveHandler: (registration) => {
                            const result = registerPluginInteractiveHandler(record.id, registration, {
                                pluginName: record.name,
                                pluginRoot: record.rootDir,
                            });
                            if (!result.ok) {
                                pushDiagnostic({
                                    level: "warn",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: result.error ?? "interactive handler registration failed",
                                });
                            }
                        },
                        onConversationBindingResolved: (handler) => registerConversationBindingResolvedHandler(record, handler),
                        registerCommand: (command) => registerCommand(record, command),
                        registerContextEngine: (id, factory) => {
                            if (id === defaultSlotIdForKey("contextEngine")) {
                                pushDiagnostic({
                                    level: "error",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: `context engine id reserved by core: ${id}`,
                                });
                                return;
                            }
                            const result = registerContextEngineForOwner(id, factory, `plugin:${record.id}`, {
                                allowSameOwnerRefresh: true,
                            });
                            if (!result.ok) {
                                pushDiagnostic({
                                    level: "error",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: `context engine already registered: ${id} (${result.existingOwner})`,
                                });
                            }
                        },
                        registerMemoryPromptSection: (builder) => {
                            if (record.kind !== "memory") {
                                pushDiagnostic({
                                    level: "error",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: "only memory plugins can register a memory prompt section",
                                });
                                return;
                            }
                            registerMemoryPromptSection(builder);
                        },
                        registerMemoryFlushPlan: (resolver) => {
                            if (record.kind !== "memory") {
                                pushDiagnostic({
                                    level: "error",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: "only memory plugins can register a memory flush plan",
                                });
                                return;
                            }
                            registerMemoryFlushPlanResolver(resolver);
                        },
                        registerMemoryRuntime: (runtime) => {
                            if (record.kind !== "memory") {
                                pushDiagnostic({
                                    level: "error",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: "only memory plugins can register a memory runtime",
                                });
                                return;
                            }
                            registerMemoryRuntime(runtime);
                        },
                        registerMemoryEmbeddingProvider: (adapter) => {
                            if (record.kind !== "memory") {
                                pushDiagnostic({
                                    level: "error",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: "only memory plugins can register memory embedding providers",
                                });
                                return;
                            }
                            const existing = getRegisteredMemoryEmbeddingProvider(adapter.id);
                            if (existing) {
                                const ownerDetail = existing.ownerPluginId
                                    ? ` (owner: ${existing.ownerPluginId})`
                                    : "";
                                pushDiagnostic({
                                    level: "error",
                                    pluginId: record.id,
                                    source: record.source,
                                    message: `memory embedding provider already registered: ${adapter.id}${ownerDetail}`,
                                });
                                return;
                            }
                            registerMemoryEmbeddingProvider(adapter, {
                                ownerPluginId: record.id,
                            });
                        },
                        on: (hookName, handler, opts) => registerTypedHook(record, hookName, handler, opts, params.hookPolicy),
                    }
                    : {}),
                registerChannel: (registration) => registerChannel(record, registration, registrationMode),
            },
        });
    };
    return {
        registry,
        createApi,
        pushDiagnostic,
        registerTool,
        registerChannel,
        registerProvider,
        registerCliBackend,
        registerSpeechProvider,
        registerMediaUnderstandingProvider,
        registerImageGenerationProvider,
        registerWebSearchProvider,
        registerGatewayMethod,
        registerCli,
        registerService,
        registerCommand,
        registerHook,
        registerTypedHook,
    };
}
