import { validateAnthropicTurns, validateGeminiTurns } from "../../pi-embedded-helpers.js";
import { sanitizeToolUseResultPairing } from "../../session-transcript-repair.js";
import { normalizeToolName } from "../../tool-policy.js";
function resolveCaseInsensitiveAllowedToolName(rawName, allowedToolNames) {
    if (!allowedToolNames || allowedToolNames.size === 0) {
        return null;
    }
    const folded = rawName.toLowerCase();
    let caseInsensitiveMatch = null;
    for (const name of allowedToolNames) {
        if (name.toLowerCase() !== folded) {
            continue;
        }
        if (caseInsensitiveMatch && caseInsensitiveMatch !== name) {
            return null;
        }
        caseInsensitiveMatch = name;
    }
    return caseInsensitiveMatch;
}
function resolveExactAllowedToolName(rawName, allowedToolNames) {
    if (!allowedToolNames || allowedToolNames.size === 0) {
        return null;
    }
    if (allowedToolNames.has(rawName)) {
        return rawName;
    }
    const normalized = normalizeToolName(rawName);
    if (allowedToolNames.has(normalized)) {
        return normalized;
    }
    return (resolveCaseInsensitiveAllowedToolName(rawName, allowedToolNames) ??
        resolveCaseInsensitiveAllowedToolName(normalized, allowedToolNames));
}
function buildStructuredToolNameCandidates(rawName) {
    const trimmed = rawName.trim();
    if (!trimmed) {
        return [];
    }
    const candidates = [];
    const seen = new Set();
    const addCandidate = (value) => {
        const candidate = value.trim();
        if (!candidate || seen.has(candidate)) {
            return;
        }
        seen.add(candidate);
        candidates.push(candidate);
    };
    addCandidate(trimmed);
    addCandidate(normalizeToolName(trimmed));
    const normalizedDelimiter = trimmed.replace(/\//g, ".");
    addCandidate(normalizedDelimiter);
    addCandidate(normalizeToolName(normalizedDelimiter));
    const segments = normalizedDelimiter
        .split(".")
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (segments.length > 1) {
        for (let index = 1; index < segments.length; index += 1) {
            const suffix = segments.slice(index).join(".");
            addCandidate(suffix);
            addCandidate(normalizeToolName(suffix));
        }
    }
    return candidates;
}
function resolveStructuredAllowedToolName(rawName, allowedToolNames) {
    if (!allowedToolNames || allowedToolNames.size === 0) {
        return null;
    }
    const candidateNames = buildStructuredToolNameCandidates(rawName);
    for (const candidate of candidateNames) {
        if (allowedToolNames.has(candidate)) {
            return candidate;
        }
    }
    for (const candidate of candidateNames) {
        const caseInsensitiveMatch = resolveCaseInsensitiveAllowedToolName(candidate, allowedToolNames);
        if (caseInsensitiveMatch) {
            return caseInsensitiveMatch;
        }
    }
    return null;
}
function inferToolNameFromToolCallId(rawId, allowedToolNames) {
    if (!rawId || !allowedToolNames || allowedToolNames.size === 0) {
        return null;
    }
    const id = rawId.trim();
    if (!id) {
        return null;
    }
    const candidateTokens = new Set();
    const addToken = (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
            return;
        }
        candidateTokens.add(trimmed);
        candidateTokens.add(trimmed.replace(/[:._/-]\d+$/, ""));
        candidateTokens.add(trimmed.replace(/\d+$/, ""));
        const normalizedDelimiter = trimmed.replace(/\//g, ".");
        candidateTokens.add(normalizedDelimiter);
        candidateTokens.add(normalizedDelimiter.replace(/[:._-]\d+$/, ""));
        candidateTokens.add(normalizedDelimiter.replace(/\d+$/, ""));
        for (const prefixPattern of [/^functions?[._-]?/i, /^tools?[._-]?/i]) {
            const stripped = normalizedDelimiter.replace(prefixPattern, "");
            if (stripped !== normalizedDelimiter) {
                candidateTokens.add(stripped);
                candidateTokens.add(stripped.replace(/[:._-]\d+$/, ""));
                candidateTokens.add(stripped.replace(/\d+$/, ""));
            }
        }
    };
    const preColon = id.split(":")[0] ?? id;
    for (const seed of [id, preColon]) {
        addToken(seed);
    }
    let singleMatch = null;
    for (const candidate of candidateTokens) {
        const matched = resolveStructuredAllowedToolName(candidate, allowedToolNames);
        if (!matched) {
            continue;
        }
        if (singleMatch && singleMatch !== matched) {
            return null;
        }
        singleMatch = matched;
    }
    return singleMatch;
}
function looksLikeMalformedToolNameCounter(rawName) {
    const normalizedDelimiter = rawName.trim().replace(/\//g, ".");
    return (/^(?:functions?|tools?)[._-]?/i.test(normalizedDelimiter) &&
        /(?:[:._-]\d+|\d+)$/.test(normalizedDelimiter));
}
function normalizeToolCallNameForDispatch(rawName, allowedToolNames, rawToolCallId) {
    const trimmed = rawName.trim();
    if (!trimmed) {
        return inferToolNameFromToolCallId(rawToolCallId, allowedToolNames) ?? rawName;
    }
    if (!allowedToolNames || allowedToolNames.size === 0) {
        return trimmed;
    }
    const exact = resolveExactAllowedToolName(trimmed, allowedToolNames);
    if (exact) {
        return exact;
    }
    const inferredFromName = inferToolNameFromToolCallId(trimmed, allowedToolNames);
    if (inferredFromName) {
        return inferredFromName;
    }
    if (looksLikeMalformedToolNameCounter(trimmed)) {
        return trimmed;
    }
    return resolveStructuredAllowedToolName(trimmed, allowedToolNames) ?? trimmed;
}
function isToolCallBlockType(type) {
    return type === "toolCall" || type === "toolUse" || type === "functionCall";
}
const REPLAY_TOOL_CALL_NAME_MAX_CHARS = 64;
function isReplayToolCallBlock(block) {
    if (!block || typeof block !== "object") {
        return false;
    }
    return isToolCallBlockType(block.type);
}
function replayToolCallHasInput(block) {
    const hasInput = "input" in block ? block.input !== undefined && block.input !== null : false;
    const hasArguments = "arguments" in block ? block.arguments !== undefined && block.arguments !== null : false;
    return hasInput || hasArguments;
}
function replayToolCallNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function resolveReplayToolCallName(rawName, rawId, allowedToolNames) {
    if (rawName.length > REPLAY_TOOL_CALL_NAME_MAX_CHARS * 2) {
        return null;
    }
    const normalized = normalizeToolCallNameForDispatch(rawName, allowedToolNames, rawId);
    const trimmed = normalized.trim();
    if (!trimmed || trimmed.length > REPLAY_TOOL_CALL_NAME_MAX_CHARS || /\s/.test(trimmed)) {
        return null;
    }
    if (!allowedToolNames || allowedToolNames.size === 0) {
        return trimmed;
    }
    return resolveExactAllowedToolName(trimmed, allowedToolNames);
}
function sanitizeReplayToolCallInputs(messages, allowedToolNames) {
    let changed = false;
    let droppedAssistantMessages = 0;
    const out = [];
    for (const message of messages) {
        if (!message || typeof message !== "object" || message.role !== "assistant") {
            out.push(message);
            continue;
        }
        if (!Array.isArray(message.content)) {
            out.push(message);
            continue;
        }
        const nextContent = [];
        let messageChanged = false;
        for (const block of message.content) {
            if (!isReplayToolCallBlock(block)) {
                nextContent.push(block);
                continue;
            }
            const replayBlock = block;
            if (!replayToolCallHasInput(replayBlock) || !replayToolCallNonEmptyString(replayBlock.id)) {
                changed = true;
                messageChanged = true;
                continue;
            }
            const rawName = typeof replayBlock.name === "string" ? replayBlock.name : "";
            const resolvedName = resolveReplayToolCallName(rawName, replayBlock.id, allowedToolNames);
            if (!resolvedName) {
                changed = true;
                messageChanged = true;
                continue;
            }
            if (replayBlock.name !== resolvedName) {
                nextContent.push({ ...block, name: resolvedName });
                changed = true;
                messageChanged = true;
                continue;
            }
            nextContent.push(block);
        }
        if (messageChanged) {
            changed = true;
            if (nextContent.length > 0) {
                out.push({ ...message, content: nextContent });
            }
            else {
                droppedAssistantMessages += 1;
            }
            continue;
        }
        out.push(message);
    }
    return {
        messages: changed ? out : messages,
        droppedAssistantMessages,
    };
}
function sanitizeAnthropicReplayToolResults(messages) {
    let changed = false;
    const out = [];
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!message || typeof message !== "object" || message.role !== "user") {
            out.push(message);
            continue;
        }
        if (!Array.isArray(message.content)) {
            out.push(message);
            continue;
        }
        const previous = messages[index - 1];
        const validToolUseIds = new Set();
        if (previous && typeof previous === "object" && previous.role === "assistant") {
            const previousContent = previous.content;
            if (Array.isArray(previousContent)) {
                for (const block of previousContent) {
                    if (!block || typeof block !== "object") {
                        continue;
                    }
                    const typedBlock = block;
                    if (typedBlock.type !== "toolUse" || typeof typedBlock.id !== "string") {
                        continue;
                    }
                    const trimmedId = typedBlock.id.trim();
                    if (trimmedId) {
                        validToolUseIds.add(trimmedId);
                    }
                }
            }
        }
        const nextContent = message.content.filter((block) => {
            if (!block || typeof block !== "object") {
                return true;
            }
            const typedBlock = block;
            if (typedBlock.type !== "toolResult" || typeof typedBlock.toolUseId !== "string") {
                return true;
            }
            return validToolUseIds.size > 0 && validToolUseIds.has(typedBlock.toolUseId);
        });
        if (nextContent.length === message.content.length) {
            out.push(message);
            continue;
        }
        changed = true;
        if (nextContent.length > 0) {
            out.push({ ...message, content: nextContent });
            continue;
        }
        out.push({
            ...message,
            content: [{ type: "text", text: "[tool results omitted]" }],
        });
    }
    return changed ? out : messages;
}
function normalizeToolCallIdsInMessage(message) {
    if (!message || typeof message !== "object") {
        return;
    }
    const content = message.content;
    if (!Array.isArray(content)) {
        return;
    }
    const usedIds = new Set();
    for (const block of content) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const typedBlock = block;
        if (!isToolCallBlockType(typedBlock.type) || typeof typedBlock.id !== "string") {
            continue;
        }
        const trimmedId = typedBlock.id.trim();
        if (!trimmedId) {
            continue;
        }
        usedIds.add(trimmedId);
    }
    let fallbackIndex = 1;
    const assignedIds = new Set();
    for (const block of content) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const typedBlock = block;
        if (!isToolCallBlockType(typedBlock.type)) {
            continue;
        }
        if (typeof typedBlock.id === "string") {
            const trimmedId = typedBlock.id.trim();
            if (trimmedId) {
                if (!assignedIds.has(trimmedId)) {
                    if (typedBlock.id !== trimmedId) {
                        typedBlock.id = trimmedId;
                    }
                    assignedIds.add(trimmedId);
                    continue;
                }
            }
        }
        let fallbackId = "";
        while (!fallbackId || usedIds.has(fallbackId) || assignedIds.has(fallbackId)) {
            fallbackId = `call_auto_${fallbackIndex++}`;
        }
        typedBlock.id = fallbackId;
        usedIds.add(fallbackId);
        assignedIds.add(fallbackId);
    }
}
function trimWhitespaceFromToolCallNamesInMessage(message, allowedToolNames) {
    if (!message || typeof message !== "object") {
        return;
    }
    const content = message.content;
    if (!Array.isArray(content)) {
        return;
    }
    for (const block of content) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const typedBlock = block;
        if (!isToolCallBlockType(typedBlock.type)) {
            continue;
        }
        const rawId = typeof typedBlock.id === "string" ? typedBlock.id : undefined;
        if (typeof typedBlock.name === "string") {
            const normalized = normalizeToolCallNameForDispatch(typedBlock.name, allowedToolNames, rawId);
            if (normalized !== typedBlock.name) {
                typedBlock.name = normalized;
            }
            continue;
        }
        const inferred = inferToolNameFromToolCallId(rawId, allowedToolNames);
        if (inferred) {
            typedBlock.name = inferred;
        }
    }
    normalizeToolCallIdsInMessage(message);
}
function wrapStreamTrimToolCallNames(stream, allowedToolNames) {
    const originalResult = stream.result.bind(stream);
    stream.result = async () => {
        const message = await originalResult();
        trimWhitespaceFromToolCallNamesInMessage(message, allowedToolNames);
        return message;
    };
    const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
    stream[Symbol.asyncIterator] =
        function () {
            const iterator = originalAsyncIterator();
            return {
                async next() {
                    const result = await iterator.next();
                    if (!result.done && result.value && typeof result.value === "object") {
                        const event = result.value;
                        trimWhitespaceFromToolCallNamesInMessage(event.partial, allowedToolNames);
                        trimWhitespaceFromToolCallNamesInMessage(event.message, allowedToolNames);
                    }
                    return result;
                },
                async return(value) {
                    return iterator.return?.(value) ?? { done: true, value: undefined };
                },
                async throw(error) {
                    return iterator.throw?.(error) ?? { done: true, value: undefined };
                },
            };
        };
    return stream;
}
export function wrapStreamFnTrimToolCallNames(baseFn, allowedToolNames) {
    return (model, context, options) => {
        const maybeStream = baseFn(model, context, options);
        if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
            return Promise.resolve(maybeStream).then((stream) => wrapStreamTrimToolCallNames(stream, allowedToolNames));
        }
        return wrapStreamTrimToolCallNames(maybeStream, allowedToolNames);
    };
}
export function wrapStreamFnSanitizeMalformedToolCalls(baseFn, allowedToolNames, transcriptPolicy) {
    return (model, context, options) => {
        const ctx = context;
        const messages = ctx?.messages;
        if (!Array.isArray(messages)) {
            return baseFn(model, context, options);
        }
        const sanitized = sanitizeReplayToolCallInputs(messages, allowedToolNames);
        if (sanitized.messages === messages) {
            return baseFn(model, context, options);
        }
        let nextMessages = sanitizeToolUseResultPairing(sanitized.messages, {
            preserveErroredAssistantResults: true,
        });
        if (transcriptPolicy?.validateAnthropicTurns) {
            nextMessages = sanitizeAnthropicReplayToolResults(nextMessages);
        }
        if (sanitized.droppedAssistantMessages > 0 || transcriptPolicy?.validateAnthropicTurns) {
            if (transcriptPolicy?.validateGeminiTurns) {
                nextMessages = validateGeminiTurns(nextMessages);
            }
            if (transcriptPolicy?.validateAnthropicTurns) {
                nextMessages = validateAnthropicTurns(nextMessages);
            }
        }
        const nextContext = {
            ...context,
            messages: nextMessages,
        };
        return baseFn(model, nextContext, options);
    };
}
