import { getPluginToolMeta } from "../plugins/tools.js";
import { resolveAgentDir, resolveAgentWorkspaceDir, resolveSessionAgentId } from "./agent-scope.js";
import { getChannelAgentToolMeta } from "./channel-tools.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
import { resolveEffectiveToolPolicy } from "./pi-tools.policy.js";
import { summarizeToolDescriptionText } from "./tool-description-summary.js";
import { resolveToolDisplay } from "./tool-display.js";
function resolveEffectiveToolLabel(tool) {
    const rawLabel = typeof tool.label === "string" ? tool.label.trim() : "";
    if (rawLabel && rawLabel.toLowerCase() !== tool.name.toLowerCase()) {
        return rawLabel;
    }
    return resolveToolDisplay({ name: tool.name }).title;
}
function resolveRawToolDescription(tool) {
    return typeof tool.description === "string" ? tool.description.trim() : "";
}
function summarizeToolDescription(tool) {
    return summarizeToolDescriptionText({
        rawDescription: resolveRawToolDescription(tool),
        displaySummary: tool.displaySummary,
    });
}
function resolveEffectiveToolSource(tool) {
    const pluginMeta = getPluginToolMeta(tool);
    if (pluginMeta) {
        return { source: "plugin", pluginId: pluginMeta.pluginId };
    }
    const channelMeta = getChannelAgentToolMeta(tool);
    if (channelMeta) {
        return { source: "channel", channelId: channelMeta.channelId };
    }
    return { source: "core" };
}
function groupLabel(source) {
    switch (source) {
        case "plugin":
            return "Connected tools";
        case "channel":
            return "Channel tools";
        default:
            return "Built-in tools";
    }
}
function disambiguateLabels(entries) {
    const counts = new Map();
    for (const entry of entries) {
        counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
    }
    return entries.map((entry) => {
        if ((counts.get(entry.label) ?? 0) < 2) {
            return entry;
        }
        const suffix = entry.pluginId ?? entry.channelId ?? entry.id;
        return { ...entry, label: `${entry.label} (${suffix})` };
    });
}
function resolveEffectiveModelCompat(params) {
    const provider = params.modelProvider?.trim();
    const modelId = params.modelId?.trim();
    if (!provider || !modelId) {
        return undefined;
    }
    try {
        return resolveModel(provider, modelId, params.agentDir, params.cfg).model?.compat;
    }
    catch {
        return undefined;
    }
}
export function resolveEffectiveToolInventory(params) {
    const agentId = params.agentId?.trim() ||
        resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg });
    const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
    const agentDir = params.agentDir ?? resolveAgentDir(params.cfg, agentId);
    const modelCompat = resolveEffectiveModelCompat({
        cfg: params.cfg,
        agentDir,
        modelProvider: params.modelProvider,
        modelId: params.modelId,
    });
    const effectiveTools = createOpenClawCodingTools({
        agentId,
        sessionKey: params.sessionKey,
        workspaceDir,
        agentDir,
        config: params.cfg,
        modelProvider: params.modelProvider,
        modelId: params.modelId,
        modelCompat,
        messageProvider: params.messageProvider,
        senderIsOwner: params.senderIsOwner,
        senderId: params.senderId,
        senderName: params.senderName ?? undefined,
        senderUsername: params.senderUsername ?? undefined,
        senderE164: params.senderE164 ?? undefined,
        agentAccountId: params.accountId ?? undefined,
        currentChannelId: params.currentChannelId,
        currentThreadTs: params.currentThreadTs,
        currentMessageId: params.currentMessageId,
        groupId: params.groupId ?? undefined,
        groupChannel: params.groupChannel ?? undefined,
        groupSpace: params.groupSpace ?? undefined,
        replyToMode: params.replyToMode,
        allowGatewaySubagentBinding: true,
        modelHasVision: params.modelHasVision,
        requireExplicitMessageTarget: params.requireExplicitMessageTarget,
        disableMessageTool: params.disableMessageTool,
    });
    const effectivePolicy = resolveEffectiveToolPolicy({
        config: params.cfg,
        agentId,
        sessionKey: params.sessionKey,
        modelProvider: params.modelProvider,
        modelId: params.modelId,
    });
    const profile = effectivePolicy.providerProfile ?? effectivePolicy.profile ?? "full";
    const entries = disambiguateLabels(effectiveTools
        .map((tool) => {
        const source = resolveEffectiveToolSource(tool);
        return {
            id: tool.name,
            label: resolveEffectiveToolLabel(tool),
            description: summarizeToolDescription(tool),
            rawDescription: resolveRawToolDescription(tool) || summarizeToolDescription(tool),
            ...source,
        };
    })
        .toSorted((a, b) => a.label.localeCompare(b.label)));
    const groupsBySource = new Map();
    for (const entry of entries) {
        const tools = groupsBySource.get(entry.source) ?? [];
        tools.push(entry);
        groupsBySource.set(entry.source, tools);
    }
    const groups = ["core", "plugin", "channel"]
        .map((source) => {
        const tools = groupsBySource.get(source);
        if (!tools || tools.length === 0) {
            return null;
        }
        return {
            id: source,
            label: groupLabel(source),
            source,
            tools,
        };
    })
        .filter((group) => group !== null);
    return { agentId, profile, groups };
}
