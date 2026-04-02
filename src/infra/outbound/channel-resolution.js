import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import { applyPluginAutoEnable } from "../../config/plugin-auto-enable.js";
import { resolveRuntimePluginRegistry } from "../../plugins/loader.js";
import { getActivePluginRegistry, getActivePluginChannelRegistryVersion, } from "../../plugins/runtime.js";
import { isDeliverableMessageChannel, normalizeMessageChannel, } from "../../utils/message-channel.js";
const bootstrapAttempts = new Set();
export function resetOutboundChannelResolutionStateForTest() {
    bootstrapAttempts.clear();
}
export function normalizeDeliverableOutboundChannel(raw) {
    const normalized = normalizeMessageChannel(raw);
    if (!normalized || !isDeliverableMessageChannel(normalized)) {
        return undefined;
    }
    return normalized;
}
function maybeBootstrapChannelPlugin(params) {
    const cfg = params.cfg;
    if (!cfg) {
        return;
    }
    const activeRegistry = getActivePluginRegistry();
    const activeHasRequestedChannel = activeRegistry?.channels?.some((entry) => entry?.plugin?.id === params.channel);
    if (activeHasRequestedChannel) {
        return;
    }
    const attemptKey = `${getActivePluginChannelRegistryVersion()}:${params.channel}`;
    if (bootstrapAttempts.has(attemptKey)) {
        return;
    }
    bootstrapAttempts.add(attemptKey);
    const autoEnabled = applyPluginAutoEnable({ config: cfg }).config;
    const defaultAgentId = resolveDefaultAgentId(autoEnabled);
    const workspaceDir = resolveAgentWorkspaceDir(autoEnabled, defaultAgentId);
    try {
        resolveRuntimePluginRegistry({
            config: autoEnabled,
            workspaceDir,
            runtimeOptions: {
                allowGatewaySubagentBinding: true,
            },
        });
    }
    catch {
        // Allow a follow-up resolution attempt if bootstrap failed transiently.
        bootstrapAttempts.delete(attemptKey);
    }
}
function resolveDirectFromActiveRegistry(channel) {
    const activeRegistry = getActivePluginRegistry();
    if (!activeRegistry) {
        return undefined;
    }
    for (const entry of activeRegistry.channels) {
        const plugin = entry?.plugin;
        if (plugin?.id === channel) {
            return plugin;
        }
    }
    return undefined;
}
export function resolveOutboundChannelPlugin(params) {
    const normalized = normalizeDeliverableOutboundChannel(params.channel);
    if (!normalized) {
        return undefined;
    }
    const resolve = () => getChannelPlugin(normalized);
    const current = resolve();
    if (current) {
        return current;
    }
    const directCurrent = resolveDirectFromActiveRegistry(normalized);
    if (directCurrent) {
        return directCurrent;
    }
    maybeBootstrapChannelPlugin({ channel: normalized, cfg: params.cfg });
    return resolve() ?? resolveDirectFromActiveRegistry(normalized);
}
