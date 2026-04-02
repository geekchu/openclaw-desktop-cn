import { defaultRuntime } from "../../runtime.js";
import { normalizeAnyChannelId } from "../registry.js";
import { getChannelPlugin, listChannelPlugins } from "./index.js";
const loggedMessageActionErrors = new Set();
export function resolveMessageActionDiscoveryChannelId(raw) {
    const normalized = normalizeAnyChannelId(raw);
    if (normalized) {
        return normalized;
    }
    const trimmed = raw?.trim();
    return trimmed || undefined;
}
export function createMessageActionDiscoveryContext(params) {
    const currentChannelProvider = resolveMessageActionDiscoveryChannelId(params.channel ?? params.currentChannelProvider);
    return {
        cfg: params.cfg ?? {},
        currentChannelId: params.currentChannelId,
        currentChannelProvider,
        currentThreadTs: params.currentThreadTs,
        currentMessageId: params.currentMessageId,
        accountId: params.accountId,
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        agentId: params.agentId,
        requesterSenderId: params.requesterSenderId,
    };
}
function logMessageActionError(params) {
    const message = params.error instanceof Error ? params.error.message : String(params.error);
    const key = `${params.pluginId}:${params.operation}:${message}`;
    if (loggedMessageActionErrors.has(key)) {
        return;
    }
    loggedMessageActionErrors.add(key);
    const stack = params.error instanceof Error && params.error.stack ? params.error.stack : null;
    defaultRuntime.error?.(`[message-action-discovery] ${params.pluginId}.actions.${params.operation} failed: ${stack ?? message}`);
}
function describeMessageToolSafely(params) {
    try {
        return params.describeMessageTool(params.context) ?? null;
    }
    catch (error) {
        logMessageActionError({
            pluginId: params.pluginId,
            operation: "describeMessageTool",
            error,
        });
        return null;
    }
}
function normalizeToolSchemaContributions(value) {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
export function resolveMessageActionDiscoveryForPlugin(params) {
    const adapter = params.actions;
    if (!adapter) {
        return {
            actions: [],
            capabilities: [],
            schemaContributions: [],
        };
    }
    const described = describeMessageToolSafely({
        pluginId: params.pluginId,
        context: params.context,
        describeMessageTool: adapter.describeMessageTool,
    });
    return {
        actions: params.includeActions && Array.isArray(described?.actions) ? [...described.actions] : [],
        capabilities: params.includeCapabilities && Array.isArray(described?.capabilities)
            ? described.capabilities
            : [],
        schemaContributions: params.includeSchema
            ? normalizeToolSchemaContributions(described?.schema)
            : [],
    };
}
export function listChannelMessageActions(cfg) {
    const actions = new Set(["send", "broadcast"]);
    for (const plugin of listChannelPlugins()) {
        for (const action of resolveMessageActionDiscoveryForPlugin({
            pluginId: plugin.id,
            actions: plugin.actions,
            context: { cfg },
            includeActions: true,
        }).actions) {
            actions.add(action);
        }
    }
    return Array.from(actions);
}
export function listChannelMessageCapabilities(cfg) {
    const capabilities = new Set();
    for (const plugin of listChannelPlugins()) {
        for (const capability of resolveMessageActionDiscoveryForPlugin({
            pluginId: plugin.id,
            actions: plugin.actions,
            context: { cfg },
            includeCapabilities: true,
        }).capabilities) {
            capabilities.add(capability);
        }
    }
    return Array.from(capabilities);
}
export function listChannelMessageCapabilitiesForChannel(params) {
    const channelId = resolveMessageActionDiscoveryChannelId(params.channel);
    if (!channelId) {
        return [];
    }
    const plugin = getChannelPlugin(channelId);
    return plugin?.actions
        ? Array.from(resolveMessageActionDiscoveryForPlugin({
            pluginId: plugin.id,
            actions: plugin.actions,
            context: createMessageActionDiscoveryContext(params),
            includeCapabilities: true,
        }).capabilities)
        : [];
}
function mergeToolSchemaProperties(target, source) {
    if (!source) {
        return;
    }
    for (const [name, schema] of Object.entries(source)) {
        if (!(name in target)) {
            target[name] = schema;
        }
    }
}
export function resolveChannelMessageToolSchemaProperties(params) {
    const properties = {};
    const currentChannel = resolveMessageActionDiscoveryChannelId(params.channel);
    const discoveryBase = createMessageActionDiscoveryContext(params);
    for (const plugin of listChannelPlugins()) {
        if (!plugin.actions) {
            continue;
        }
        for (const contribution of resolveMessageActionDiscoveryForPlugin({
            pluginId: plugin.id,
            actions: plugin.actions,
            context: discoveryBase,
            includeSchema: true,
        }).schemaContributions) {
            const visibility = contribution.visibility ?? "current-channel";
            if (currentChannel) {
                if (visibility === "all-configured" || plugin.id === currentChannel) {
                    mergeToolSchemaProperties(properties, contribution.properties);
                }
                continue;
            }
            mergeToolSchemaProperties(properties, contribution.properties);
        }
    }
    return properties;
}
export function channelSupportsMessageCapability(cfg, capability) {
    return listChannelMessageCapabilities(cfg).includes(capability);
}
export function channelSupportsMessageCapabilityForChannel(params, capability) {
    return listChannelMessageCapabilitiesForChannel(params).includes(capability);
}
export const __testing = {
    resetLoggedMessageActionErrors() {
        loggedMessageActionErrors.clear();
    },
};
