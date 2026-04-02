import { randomUUID } from "node:crypto";
import { buildAssistantMessage, buildUsageWithNoCost } from "./stream-message-shared.js";
function toNonEmptyString(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeAssistantPhase(value) {
    return value === "commentary" || value === "final_answer" ? value : undefined;
}
function encodeAssistantTextSignature(params) {
    return JSON.stringify({
        v: 1,
        id: params.id,
        ...(params.phase ? { phase: params.phase } : {}),
    });
}
function parseAssistantTextSignature(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return null;
    }
    if (!value.startsWith("{")) {
        return { id: value };
    }
    try {
        const parsed = JSON.parse(value);
        if (parsed.v !== 1 || typeof parsed.id !== "string") {
            return null;
        }
        return {
            id: parsed.id,
            ...(normalizeAssistantPhase(parsed.phase)
                ? { phase: normalizeAssistantPhase(parsed.phase) }
                : {}),
        };
    }
    catch {
        return null;
    }
}
function supportsImageInput(modelOverride) {
    return !Array.isArray(modelOverride?.input) || modelOverride.input.includes("image");
}
function contentToText(content) {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content
        .filter((part) => Boolean(part) && typeof part === "object")
        .filter((part) => (part.type === "text" || part.type === "input_text" || part.type === "output_text") &&
        typeof part.text === "string")
        .map((part) => part.text)
        .join("");
}
function contentToOpenAIParts(content, modelOverride) {
    if (typeof content === "string") {
        return content ? [{ type: "input_text", text: content }] : [];
    }
    if (!Array.isArray(content)) {
        return [];
    }
    const includeImages = supportsImageInput(modelOverride);
    const parts = [];
    for (const part of content) {
        if ((part.type === "text" || part.type === "input_text" || part.type === "output_text") &&
            typeof part.text === "string") {
            parts.push({ type: "input_text", text: part.text });
            continue;
        }
        if (!includeImages) {
            continue;
        }
        if (part.type === "image" && typeof part.data === "string") {
            parts.push({
                type: "input_image",
                source: {
                    type: "base64",
                    media_type: part.mimeType ?? "image/jpeg",
                    data: part.data,
                },
            });
            continue;
        }
        if (part.type === "input_image" &&
            part.source &&
            typeof part.source === "object" &&
            typeof part.source.type === "string") {
            parts.push({
                type: "input_image",
                source: part.source,
            });
        }
    }
    return parts;
}
function isReplayableReasoningType(value) {
    return typeof value === "string" && (value === "reasoning" || value.startsWith("reasoning."));
}
function toReplayableReasoningId(value) {
    const id = toNonEmptyString(value);
    return id && id.startsWith("rs_") ? id : null;
}
function toReasoningSignature(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value;
    if (!isReplayableReasoningType(record.type)) {
        return null;
    }
    const reasoningId = toReplayableReasoningId(record.id);
    return {
        type: record.type,
        ...(reasoningId ? { id: reasoningId } : {}),
    };
}
function encodeThinkingSignature(signature) {
    return JSON.stringify(signature);
}
function parseReasoningItem(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value;
    if (!isReplayableReasoningType(record.type)) {
        return null;
    }
    const reasoningId = toReplayableReasoningId(record.id);
    return {
        type: "reasoning",
        ...(reasoningId ? { id: reasoningId } : {}),
        ...(typeof record.content === "string" ? { content: record.content } : {}),
        ...(typeof record.encrypted_content === "string"
            ? { encrypted_content: record.encrypted_content }
            : {}),
        ...(typeof record.summary === "string" ? { summary: record.summary } : {}),
    };
}
function parseThinkingSignature(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return null;
    }
    try {
        const signature = toReasoningSignature(JSON.parse(value));
        return signature ? parseReasoningItem(signature) : null;
    }
    catch {
        return null;
    }
}
function encodeToolCallReplayId(params) {
    return params.itemId ? `${params.callId}|${params.itemId}` : params.callId;
}
function decodeToolCallReplayId(value) {
    const raw = toNonEmptyString(value);
    if (!raw) {
        return null;
    }
    const [callId, itemId] = raw.split("|", 2);
    return {
        callId,
        ...(itemId ? { itemId } : {}),
    };
}
function extractReasoningSummaryText(value) {
    if (typeof value === "string") {
        return value.trim();
    }
    if (!Array.isArray(value)) {
        return "";
    }
    return value
        .map((item) => {
        if (typeof item === "string") {
            return item.trim();
        }
        if (!item || typeof item !== "object") {
            return "";
        }
        const record = item;
        return typeof record.text === "string" ? record.text.trim() : "";
    })
        .filter(Boolean)
        .join("\n")
        .trim();
}
function extractResponseReasoningText(item) {
    if (!item || typeof item !== "object") {
        return "";
    }
    const record = item;
    const summaryText = extractReasoningSummaryText(record.summary);
    if (summaryText) {
        return summaryText;
    }
    return typeof record.content === "string" ? record.content.trim() : "";
}
export function convertTools(tools) {
    if (!tools || tools.length === 0) {
        return [];
    }
    return tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : undefined,
        parameters: (tool.parameters ?? {}),
    }));
}
export function planTurnInput(params) {
    if (params.previousResponseId && params.lastContextLength > 0) {
        const newMessages = params.context.messages.slice(params.lastContextLength);
        const toolResults = newMessages.filter((message) => message.role === "toolResult");
        if (toolResults.length > 0) {
            return {
                mode: "incremental_tool_results",
                previousResponseId: params.previousResponseId,
                inputItems: convertMessagesToInputItems(toolResults, params.model),
            };
        }
        return {
            mode: "full_context_restart",
            inputItems: convertMessagesToInputItems(params.context.messages, params.model),
        };
    }
    return {
        mode: "full_context_initial",
        inputItems: convertMessagesToInputItems(params.context.messages, params.model),
    };
}
export function convertMessagesToInputItems(messages, modelOverride) {
    const items = [];
    for (const msg of messages) {
        const m = msg;
        if (m.role === "user") {
            const parts = contentToOpenAIParts(m.content, modelOverride);
            if (parts.length === 0) {
                continue;
            }
            items.push({
                type: "message",
                role: "user",
                content: parts.length === 1 && parts[0]?.type === "input_text"
                    ? parts[0].text
                    : parts,
            });
            continue;
        }
        if (m.role === "assistant") {
            const content = m.content;
            let assistantPhase = normalizeAssistantPhase(m.phase);
            if (Array.isArray(content)) {
                const textParts = [];
                const pushAssistantText = () => {
                    if (textParts.length === 0) {
                        return;
                    }
                    items.push({
                        type: "message",
                        role: "assistant",
                        content: textParts.join(""),
                        ...(assistantPhase ? { phase: assistantPhase } : {}),
                    });
                    textParts.length = 0;
                };
                for (const block of content) {
                    if (block.type === "text" && typeof block.text === "string") {
                        const parsedSignature = parseAssistantTextSignature(block.textSignature);
                        if (!assistantPhase) {
                            assistantPhase = parsedSignature?.phase;
                        }
                        textParts.push(block.text);
                        continue;
                    }
                    if (block.type === "thinking") {
                        pushAssistantText();
                        const reasoningItem = parseThinkingSignature(block.thinkingSignature);
                        if (reasoningItem) {
                            items.push(reasoningItem);
                        }
                        continue;
                    }
                    if (block.type !== "toolCall") {
                        continue;
                    }
                    pushAssistantText();
                    const replayId = decodeToolCallReplayId(block.id);
                    const toolName = toNonEmptyString(block.name);
                    if (!replayId || !toolName) {
                        continue;
                    }
                    items.push({
                        type: "function_call",
                        ...(replayId.itemId ? { id: replayId.itemId } : {}),
                        call_id: replayId.callId,
                        name: toolName,
                        arguments: typeof block.arguments === "string"
                            ? block.arguments
                            : JSON.stringify(block.arguments ?? {}),
                    });
                }
                pushAssistantText();
                continue;
            }
            const text = contentToText(content);
            if (!text) {
                continue;
            }
            items.push({
                type: "message",
                role: "assistant",
                content: text,
                ...(assistantPhase ? { phase: assistantPhase } : {}),
            });
            continue;
        }
        if (m.role !== "toolResult") {
            continue;
        }
        const toolCallId = toNonEmptyString(m.toolCallId) ?? toNonEmptyString(m.toolUseId);
        if (!toolCallId) {
            continue;
        }
        const replayId = decodeToolCallReplayId(toolCallId);
        if (!replayId) {
            continue;
        }
        const parts = Array.isArray(m.content) ? contentToOpenAIParts(m.content, modelOverride) : [];
        const textOutput = contentToText(m.content);
        const imageParts = parts.filter((part) => part.type === "input_image");
        items.push({
            type: "function_call_output",
            call_id: replayId.callId,
            output: textOutput || (imageParts.length > 0 ? "(see attached image)" : ""),
        });
        if (imageParts.length > 0) {
            items.push({
                type: "message",
                role: "user",
                content: [
                    { type: "input_text", text: "Attached image(s) from tool result:" },
                    ...imageParts,
                ],
            });
        }
    }
    return items;
}
export function buildAssistantMessageFromResponse(response, modelInfo) {
    const content = [];
    let assistantPhase;
    for (const item of response.output ?? []) {
        if (item.type === "message") {
            const itemPhase = normalizeAssistantPhase(item.phase);
            if (itemPhase) {
                assistantPhase = itemPhase;
            }
            for (const part of item.content ?? []) {
                if (part.type === "output_text" && part.text) {
                    content.push({
                        type: "text",
                        text: part.text,
                        textSignature: encodeAssistantTextSignature({
                            id: item.id,
                            ...(itemPhase ? { phase: itemPhase } : {}),
                        }),
                    });
                }
            }
        }
        else if (item.type === "function_call") {
            const toolName = toNonEmptyString(item.name);
            if (!toolName) {
                continue;
            }
            const callId = toNonEmptyString(item.call_id);
            const itemId = toNonEmptyString(item.id);
            content.push({
                type: "toolCall",
                id: encodeToolCallReplayId({
                    callId: callId ?? `call_${randomUUID()}`,
                    itemId: itemId ?? undefined,
                }),
                name: toolName,
                arguments: (() => {
                    try {
                        return JSON.parse(item.arguments);
                    }
                    catch {
                        return {};
                    }
                })(),
            });
        }
        else {
            if (!isReplayableReasoningType(item.type)) {
                continue;
            }
            const reasoning = extractResponseReasoningText(item);
            if (!reasoning) {
                continue;
            }
            const reasoningId = toReplayableReasoningId(item.id);
            content.push({
                type: "thinking",
                thinking: reasoning,
                ...(reasoningId
                    ? {
                        thinkingSignature: encodeThinkingSignature({
                            id: reasoningId,
                            type: item.type,
                        }),
                    }
                    : {}),
            });
        }
    }
    const hasToolCalls = content.some((part) => part.type === "toolCall");
    const stopReason = hasToolCalls ? "toolUse" : "stop";
    const message = buildAssistantMessage({
        model: modelInfo,
        content,
        stopReason,
        usage: buildUsageWithNoCost({
            input: response.usage?.input_tokens ?? 0,
            output: response.usage?.output_tokens ?? 0,
            totalTokens: response.usage?.total_tokens ?? 0,
        }),
    });
    return assistantPhase
        ? { ...message, phase: assistantPhase }
        : message;
}
