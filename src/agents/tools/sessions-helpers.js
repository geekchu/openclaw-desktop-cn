export { createAgentToAgentPolicy, createSessionVisibilityGuard, resolveEffectiveSessionToolsVisibility, resolveSandboxSessionToolsVisibility, resolveSandboxedSessionToolContext, resolveSessionToolsVisibility, } from "./sessions-access.js";
import { resolveSandboxedSessionToolContext } from "./sessions-access.js";
export { isRequesterSpawnedSessionVisible, isResolvedSessionVisibleToRequester, listSpawnedSessionKeys, looksLikeSessionId, looksLikeSessionKey, resolveDisplaySessionKey, resolveInternalSessionKey, resolveMainSessionAlias, resolveSessionReference, resolveVisibleSessionReference, shouldResolveSessionIdInput, shouldVerifyRequesterSpawnedSessionVisibility, } from "./sessions-resolution.js";
import { loadConfig } from "../../config/config.js";
import { extractTextFromChatContent } from "../../shared/chat-content.js";
import { sanitizeUserFacingText } from "../pi-embedded-helpers.js";
import { stripDowngradedToolCallText, stripMinimaxToolCallXml, stripModelSpecialTokens, stripThinkingTagsFromText, } from "../pi-embedded-utils.js";
function normalizeKey(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
export function resolveSessionToolContext(opts) {
    const cfg = opts?.config ?? loadConfig();
    return {
        cfg,
        ...resolveSandboxedSessionToolContext({
            cfg,
            agentSessionKey: opts?.agentSessionKey,
            sandboxed: opts?.sandboxed,
        }),
    };
}
export function classifySessionKind(params) {
    const key = params.key;
    if (key === params.alias || key === params.mainKey) {
        return "main";
    }
    if (key.startsWith("cron:")) {
        return "cron";
    }
    if (key.startsWith("hook:")) {
        return "hook";
    }
    if (key.startsWith("node-") || key.startsWith("node:")) {
        return "node";
    }
    if (params.gatewayKind === "group") {
        return "group";
    }
    if (key.includes(":group:") || key.includes(":channel:")) {
        return "group";
    }
    return "other";
}
export function deriveChannel(params) {
    if (params.kind === "cron" || params.kind === "hook" || params.kind === "node") {
        return "internal";
    }
    const channel = normalizeKey(params.channel ?? undefined);
    if (channel) {
        return channel;
    }
    const lastChannel = normalizeKey(params.lastChannel ?? undefined);
    if (lastChannel) {
        return lastChannel;
    }
    const parts = params.key.split(":").filter(Boolean);
    if (parts.length >= 3 && (parts[1] === "group" || parts[1] === "channel")) {
        return parts[0];
    }
    return "unknown";
}
export function stripToolMessages(messages) {
    return messages.filter((msg) => {
        if (!msg || typeof msg !== "object") {
            return true;
        }
        const role = msg.role;
        return role !== "toolResult" && role !== "tool";
    });
}
/**
 * Sanitize text content to strip tool call markers and thinking tags.
 * This ensures user-facing text doesn't leak internal tool representations.
 */
export function sanitizeTextContent(text) {
    if (!text) {
        return text;
    }
    return stripThinkingTagsFromText(stripDowngradedToolCallText(stripModelSpecialTokens(stripMinimaxToolCallXml(text))));
}
export function extractAssistantText(message) {
    if (!message || typeof message !== "object") {
        return undefined;
    }
    if (message.role !== "assistant") {
        return undefined;
    }
    const content = message.content;
    if (!Array.isArray(content)) {
        return undefined;
    }
    const joined = extractTextFromChatContent(content, {
        sanitizeText: sanitizeTextContent,
        joinWith: "",
        normalizeText: (text) => text.trim(),
    }) ?? "";
    const stopReason = message.stopReason;
    // Gate on stopReason only — a non-error response with a stale/background errorMessage
    // should not have its content rewritten with error templates (#13935).
    const errorContext = stopReason === "error";
    return joined ? sanitizeUserFacingText(joined, { errorContext }) : undefined;
}
