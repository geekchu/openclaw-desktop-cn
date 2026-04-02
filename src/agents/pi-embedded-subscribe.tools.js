import { getChannelPlugin, normalizeChannelId } from "../channels/plugins/index.js";
import { normalizeTargetForProvider } from "../infra/outbound/target-normalization.js";
import { splitMediaFromOutput } from "../media/parse.js";
import { truncateUtf16Safe } from "../utils.js";
import { collectTextContentBlocks } from "./content-blocks.js";
import { normalizeToolName } from "./tool-policy.js";
const TOOL_RESULT_MAX_CHARS = 8000;
const TOOL_ERROR_MAX_CHARS = 400;
function truncateToolText(text) {
    if (text.length <= TOOL_RESULT_MAX_CHARS) {
        return text;
    }
    return `${truncateUtf16Safe(text, TOOL_RESULT_MAX_CHARS)}\n…(truncated)…`;
}
function normalizeToolErrorText(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return undefined;
    }
    const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
    if (!firstLine) {
        return undefined;
    }
    return firstLine.length > TOOL_ERROR_MAX_CHARS
        ? `${truncateUtf16Safe(firstLine, TOOL_ERROR_MAX_CHARS)}…`
        : firstLine;
}
function isErrorLikeStatus(status) {
    const normalized = status.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    if (normalized === "0" ||
        normalized === "ok" ||
        normalized === "success" ||
        normalized === "completed" ||
        normalized === "running") {
        return false;
    }
    return /error|fail|timeout|timed[_\s-]?out|denied|cancel|invalid|forbidden/.test(normalized);
}
function readErrorCandidate(value) {
    if (typeof value === "string") {
        return normalizeToolErrorText(value);
    }
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    if (typeof record.message === "string") {
        return normalizeToolErrorText(record.message);
    }
    if (typeof record.error === "string") {
        return normalizeToolErrorText(record.error);
    }
    return undefined;
}
function extractErrorField(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    const direct = readErrorCandidate(record.error) ??
        readErrorCandidate(record.message) ??
        readErrorCandidate(record.reason);
    if (direct) {
        return direct;
    }
    const status = typeof record.status === "string" ? record.status.trim() : "";
    if (!status || !isErrorLikeStatus(status)) {
        return undefined;
    }
    return normalizeToolErrorText(status);
}
export function sanitizeToolResult(result) {
    if (!result || typeof result !== "object") {
        return result;
    }
    const record = result;
    const content = Array.isArray(record.content) ? record.content : null;
    if (!content) {
        return record;
    }
    const sanitized = content.map((item) => {
        if (!item || typeof item !== "object") {
            return item;
        }
        const entry = item;
        const type = typeof entry.type === "string" ? entry.type : undefined;
        if (type === "text" && typeof entry.text === "string") {
            return { ...entry, text: truncateToolText(entry.text) };
        }
        if (type === "image") {
            const data = typeof entry.data === "string" ? entry.data : undefined;
            const bytes = data ? data.length : undefined;
            const cleaned = { ...entry };
            delete cleaned.data;
            return { ...cleaned, bytes, omitted: true };
        }
        return entry;
    });
    return { ...record, content: sanitized };
}
export function extractToolResultText(result) {
    if (!result || typeof result !== "object") {
        return undefined;
    }
    const record = result;
    const texts = collectTextContentBlocks(record.content)
        .map((item) => {
        const trimmed = item.trim();
        return trimmed ? trimmed : undefined;
    })
        .filter((value) => Boolean(value));
    if (texts.length === 0) {
        return undefined;
    }
    return texts.join("\n");
}
// Core tool names that are allowed to emit local MEDIA: paths.
// Plugin/MCP tools are intentionally excluded to prevent untrusted file reads.
const TRUSTED_TOOL_RESULT_MEDIA = new Set([
    "agents_list",
    "apply_patch",
    "browser",
    "canvas",
    "cron",
    "edit",
    "exec",
    "gateway",
    "image",
    "image_generate",
    "memory_get",
    "memory_search",
    "message",
    "nodes",
    "process",
    "read",
    "session_status",
    "sessions_history",
    "sessions_list",
    "sessions_send",
    "sessions_spawn",
    "subagents",
    "tts",
    "web_fetch",
    "web_search",
    "x_search",
    "write",
]);
const HTTP_URL_RE = /^https?:\/\//i;
function readToolResultDetails(result) {
    if (!result || typeof result !== "object") {
        return undefined;
    }
    const record = result;
    return record.details && typeof record.details === "object" && !Array.isArray(record.details)
        ? record.details
        : undefined;
}
function isExternalToolResult(result) {
    const details = readToolResultDetails(result);
    if (!details) {
        return false;
    }
    return typeof details.mcpServer === "string" || typeof details.mcpTool === "string";
}
export function isToolResultMediaTrusted(toolName, result) {
    if (!toolName || isExternalToolResult(result)) {
        return false;
    }
    const normalized = normalizeToolName(toolName);
    return TRUSTED_TOOL_RESULT_MEDIA.has(normalized);
}
export function filterToolResultMediaUrls(toolName, mediaUrls, result) {
    if (mediaUrls.length === 0) {
        return mediaUrls;
    }
    if (isToolResultMediaTrusted(toolName, result)) {
        return mediaUrls;
    }
    return mediaUrls.filter((url) => HTTP_URL_RE.test(url.trim()));
}
function readToolResultDetailsMedia(result) {
    const details = readToolResultDetails(result);
    const media = details?.media && typeof details.media === "object" && !Array.isArray(details.media)
        ? details.media
        : undefined;
    return media;
}
function collectStructuredMediaUrls(media) {
    const urls = [];
    if (typeof media.mediaUrl === "string" && media.mediaUrl.trim()) {
        urls.push(media.mediaUrl.trim());
    }
    if (Array.isArray(media.mediaUrls)) {
        urls.push(...media.mediaUrls
            .filter((value) => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean));
    }
    return Array.from(new Set(urls));
}
export function extractToolResultMediaArtifact(result) {
    if (!result || typeof result !== "object") {
        return undefined;
    }
    const record = result;
    const detailsMedia = readToolResultDetailsMedia(record);
    if (detailsMedia) {
        const mediaUrls = collectStructuredMediaUrls(detailsMedia);
        if (mediaUrls.length > 0) {
            return {
                mediaUrls,
                ...(detailsMedia.audioAsVoice === true ? { audioAsVoice: true } : {}),
            };
        }
    }
    const content = Array.isArray(record.content) ? record.content : null;
    if (!content) {
        return undefined;
    }
    // Extract legacy MEDIA: paths from text content blocks using the shared
    // parser so directive matching and validation stay in sync with outbound
    // reply parsing.
    const paths = [];
    let hasImageContent = false;
    for (const item of content) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const entry = item;
        if (entry.type === "image") {
            hasImageContent = true;
            continue;
        }
        if (entry.type === "text" && typeof entry.text === "string") {
            const parsed = splitMediaFromOutput(entry.text);
            if (parsed.mediaUrls?.length) {
                paths.push(...parsed.mediaUrls);
            }
        }
    }
    if (paths.length > 0) {
        return { mediaUrls: paths };
    }
    // Fall back to legacy details.path when image content exists but no
    // structured media details or MEDIA: text.
    if (hasImageContent) {
        const details = record.details;
        const p = typeof details?.path === "string" ? details.path.trim() : "";
        if (p) {
            return { mediaUrls: [p] };
        }
    }
    return undefined;
}
export function extractToolResultMediaPaths(result) {
    return extractToolResultMediaArtifact(result)?.mediaUrls ?? [];
}
export function isToolResultError(result) {
    if (!result || typeof result !== "object") {
        return false;
    }
    const record = result;
    const details = record.details;
    if (!details || typeof details !== "object") {
        return false;
    }
    const status = details.status;
    if (typeof status !== "string") {
        return false;
    }
    const normalized = status.trim().toLowerCase();
    return normalized === "error" || normalized === "timeout";
}
export function extractToolErrorMessage(result) {
    if (!result || typeof result !== "object") {
        return undefined;
    }
    const record = result;
    const fromDetails = extractErrorField(record.details);
    if (fromDetails) {
        return fromDetails;
    }
    const fromRoot = extractErrorField(record);
    if (fromRoot) {
        return fromRoot;
    }
    const text = extractToolResultText(result);
    if (!text) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(text);
        const fromJson = extractErrorField(parsed);
        if (fromJson) {
            return fromJson;
        }
    }
    catch {
        // Fall through to first-line text fallback.
    }
    return normalizeToolErrorText(text);
}
function resolveMessageToolTarget(args) {
    const toRaw = typeof args.to === "string" ? args.to : undefined;
    if (toRaw) {
        return toRaw;
    }
    return typeof args.target === "string" ? args.target : undefined;
}
export function extractMessagingToolSend(toolName, args) {
    // Provider docking: new provider tools must implement plugin.actions.extractToolSend.
    const action = typeof args.action === "string" ? args.action.trim() : "";
    const accountIdRaw = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
    const accountId = accountIdRaw ? accountIdRaw : undefined;
    if (toolName === "message") {
        if (action !== "send" && action !== "thread-reply") {
            return undefined;
        }
        const toRaw = resolveMessageToolTarget(args);
        if (!toRaw) {
            return undefined;
        }
        const providerRaw = typeof args.provider === "string" ? args.provider.trim() : "";
        const channelRaw = typeof args.channel === "string" ? args.channel.trim() : "";
        const providerHint = providerRaw || channelRaw;
        const providerId = providerHint ? normalizeChannelId(providerHint) : null;
        const provider = providerId ?? (providerHint ? providerHint.toLowerCase() : "message");
        const to = normalizeTargetForProvider(provider, toRaw);
        return to ? { tool: toolName, provider, accountId, to } : undefined;
    }
    const providerId = normalizeChannelId(toolName);
    if (!providerId) {
        return undefined;
    }
    const plugin = getChannelPlugin(providerId);
    const extracted = plugin?.actions?.extractToolSend?.({ args });
    if (!extracted?.to) {
        return undefined;
    }
    const to = normalizeTargetForProvider(providerId, extracted.to);
    return to
        ? {
            tool: toolName,
            provider: providerId,
            accountId: extracted.accountId ?? accountId,
            to,
        }
        : undefined;
}
