import { matchesExactOrPrefix } from "../plugin-sdk/provider-model-shared.js";
const BASE_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "adaptive"];
const ANTHROPIC_CLAUDE_46_MODEL_RE = /^claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const AMAZON_BEDROCK_CLAUDE_46_MODEL_RE = /claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const OPENAI_XHIGH_MODEL_IDS = [
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
];
const OPENAI_CODEX_XHIGH_MODEL_IDS = [
    "gpt-5.4",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    "gpt-5.1-codex",
];
const GITHUB_COPILOT_XHIGH_MODEL_IDS = ["gpt-5.2", "gpt-5.2-codex"];
export function normalizeProviderId(provider) {
    if (!provider) {
        return "";
    }
    const normalized = provider.trim().toLowerCase();
    if (normalized === "z.ai" || normalized === "z-ai") {
        return "zai";
    }
    if (normalized === "bedrock" || normalized === "aws-bedrock") {
        return "amazon-bedrock";
    }
    return normalized;
}
export function isBinaryThinkingProvider(provider) {
    return normalizeProviderId(provider) === "zai";
}
export function supportsBuiltInXHighThinking(provider, model) {
    const providerId = normalizeProviderId(provider);
    const modelId = model?.trim().toLowerCase();
    if (!providerId || !modelId) {
        return false;
    }
    if (providerId === "openai") {
        return matchesExactOrPrefix(modelId, OPENAI_XHIGH_MODEL_IDS);
    }
    if (providerId === "openai-codex") {
        return matchesExactOrPrefix(modelId, OPENAI_CODEX_XHIGH_MODEL_IDS);
    }
    if (providerId === "github-copilot") {
        return GITHUB_COPILOT_XHIGH_MODEL_IDS.includes(modelId);
    }
    return false;
}
// Normalize user-provided thinking level strings to the canonical enum.
export function normalizeThinkLevel(raw) {
    if (!raw) {
        return undefined;
    }
    const key = raw.trim().toLowerCase();
    const collapsed = key.replace(/[\s_-]+/g, "");
    if (collapsed === "adaptive" || collapsed === "auto") {
        return "adaptive";
    }
    if (collapsed === "xhigh" || collapsed === "extrahigh") {
        return "xhigh";
    }
    if (["off"].includes(key)) {
        return "off";
    }
    if (["on", "enable", "enabled"].includes(key)) {
        return "low";
    }
    if (["min", "minimal"].includes(key)) {
        return "minimal";
    }
    if (["low", "thinkhard", "think-hard", "think_hard"].includes(key)) {
        return "low";
    }
    if (["mid", "med", "medium", "thinkharder", "think-harder", "harder"].includes(key)) {
        return "medium";
    }
    if (["high", "ultra", "ultrathink", "think-hard", "thinkhardest", "highest", "max"].includes(key)) {
        return "high";
    }
    if (["think"].includes(key)) {
        return "minimal";
    }
    return undefined;
}
export function listThinkingLevels(_provider, _model) {
    return [...BASE_THINKING_LEVELS];
}
export function listThinkingLevelLabels(provider, model) {
    if (isBinaryThinkingProvider(provider)) {
        return ["off", "on"];
    }
    return listThinkingLevels(provider, model);
}
export function formatThinkingLevels(provider, model, separator = ", ") {
    return listThinkingLevelLabels(provider, model).join(separator);
}
export function formatXHighModelHint() {
    return "provider models that advertise xhigh reasoning";
}
export function resolveThinkingDefaultForModel(params) {
    const normalizedProvider = normalizeProviderId(params.provider);
    const modelId = params.model.trim();
    if (normalizedProvider === "anthropic" && ANTHROPIC_CLAUDE_46_MODEL_RE.test(modelId)) {
        return "adaptive";
    }
    if (normalizedProvider === "amazon-bedrock" && AMAZON_BEDROCK_CLAUDE_46_MODEL_RE.test(modelId)) {
        return "adaptive";
    }
    const candidate = params.catalog?.find((entry) => entry.provider === params.provider && entry.id === params.model);
    if (candidate?.reasoning) {
        return "low";
    }
    return "off";
}
function normalizeOnOffFullLevel(raw) {
    if (!raw) {
        return undefined;
    }
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0"].includes(key)) {
        return "off";
    }
    if (["full", "all", "everything"].includes(key)) {
        return "full";
    }
    if (["on", "minimal", "true", "yes", "1"].includes(key)) {
        return "on";
    }
    return undefined;
}
export function normalizeVerboseLevel(raw) {
    return normalizeOnOffFullLevel(raw);
}
export function normalizeNoticeLevel(raw) {
    return normalizeOnOffFullLevel(raw);
}
export function normalizeUsageDisplay(raw) {
    if (!raw) {
        return undefined;
    }
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0", "disable", "disabled"].includes(key)) {
        return "off";
    }
    if (["on", "true", "yes", "1", "enable", "enabled"].includes(key)) {
        return "tokens";
    }
    if (["tokens", "token", "tok", "minimal", "min"].includes(key)) {
        return "tokens";
    }
    if (["full", "session"].includes(key)) {
        return "full";
    }
    return undefined;
}
export function resolveResponseUsageMode(raw) {
    return normalizeUsageDisplay(raw) ?? "off";
}
export function normalizeFastMode(raw) {
    if (typeof raw === "boolean") {
        return raw;
    }
    if (!raw) {
        return undefined;
    }
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0", "disable", "disabled", "normal"].includes(key)) {
        return false;
    }
    if (["on", "true", "yes", "1", "enable", "enabled", "fast"].includes(key)) {
        return true;
    }
    return undefined;
}
export function normalizeElevatedLevel(raw) {
    if (!raw) {
        return undefined;
    }
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0"].includes(key)) {
        return "off";
    }
    if (["full", "auto", "auto-approve", "autoapprove"].includes(key)) {
        return "full";
    }
    if (["ask", "prompt", "approval", "approve"].includes(key)) {
        return "ask";
    }
    if (["on", "true", "yes", "1"].includes(key)) {
        return "on";
    }
    return undefined;
}
export function resolveElevatedMode(level) {
    if (!level || level === "off") {
        return "off";
    }
    if (level === "full") {
        return "full";
    }
    return "ask";
}
export function normalizeReasoningLevel(raw) {
    if (!raw) {
        return undefined;
    }
    const key = raw.toLowerCase();
    if (["off", "false", "no", "0", "hide", "hidden", "disable", "disabled"].includes(key)) {
        return "off";
    }
    if (["on", "true", "yes", "1", "show", "visible", "enable", "enabled"].includes(key)) {
        return "on";
    }
    if (["stream", "streaming", "draft", "live"].includes(key)) {
        return "stream";
    }
    return undefined;
}
