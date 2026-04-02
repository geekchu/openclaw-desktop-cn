import { createDedupeCache, formatInboundFromLabel as formatInboundFromLabelShared, rawDataToString, resolveThreadSessionKeys as resolveThreadSessionKeysShared, } from "./runtime-api.js";
export { createDedupeCache, rawDataToString };
export function extractShortModelName(fullModel) {
    const slash = fullModel.lastIndexOf("/");
    const modelPart = slash >= 0 ? fullModel.slice(slash + 1) : fullModel;
    return modelPart.replace(/-\d{8}$/, "").replace(/-latest$/, "");
}
export const formatInboundFromLabel = formatInboundFromLabelShared;
function normalizeAgentId(value) {
    const trimmed = (value ?? "").trim();
    if (!trimmed) {
        return "main";
    }
    if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)) {
        return trimmed;
    }
    return (trimmed
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "")
        .slice(0, 64) || "main");
}
function isAgentEntry(entry) {
    return Boolean(entry && typeof entry === "object");
}
function listAgents(cfg) {
    return Array.isArray(cfg.agents?.list) ? cfg.agents.list.filter(isAgentEntry) : [];
}
function resolveAgentEntry(cfg, agentId) {
    const id = normalizeAgentId(agentId);
    return listAgents(cfg).find((entry) => normalizeAgentId(entry.id) === id);
}
export function resolveIdentityName(cfg, agentId) {
    const entry = resolveAgentEntry(cfg, agentId);
    return entry?.identity?.name?.trim() || undefined;
}
export function resolveThreadSessionKeys(params) {
    return resolveThreadSessionKeysShared({
        ...params,
        normalizeThreadId: (threadId) => threadId,
    });
}
/**
 * Strip bot mention from message text while preserving newlines and
 * block-level Markdown formatting (headings, lists, blockquotes).
 */
export function normalizeMention(text, mention) {
    if (!mention) {
        return text.trim();
    }
    const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasMentionRe = new RegExp(`@${escaped}\\b`, "i");
    const leadingMentionRe = new RegExp(`^([\\t ]*)@${escaped}\\b[\\t ]*`, "i");
    const trailingMentionRe = new RegExp(`[\\t ]*@${escaped}\\b[\\t ]*$`, "i");
    const normalizedLines = text.split("\n").map((line) => {
        const hadMention = hasMentionRe.test(line);
        const normalizedLine = line
            .replace(leadingMentionRe, "$1")
            .replace(trailingMentionRe, "")
            .replace(new RegExp(`@${escaped}\\b`, "gi"), "")
            .replace(/(\S)[ \t]{2,}/g, "$1 ");
        return {
            text: normalizedLine,
            mentionOnlyBlank: hadMention && normalizedLine.trim() === "",
        };
    });
    while (normalizedLines[0]?.mentionOnlyBlank) {
        normalizedLines.shift();
    }
    while (normalizedLines.at(-1)?.text.trim() === "") {
        normalizedLines.pop();
    }
    return normalizedLines.map((line) => line.text).join("\n");
}
