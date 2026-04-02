import { normalizeProviderId } from "../../model-selection.js";
import { log } from "../logger.js";
function isToolCallBlockType(type) {
    return type === "toolCall" || type === "toolUse" || type === "functionCall";
}
function extractBalancedJsonPrefix(raw) {
    let start = 0;
    while (start < raw.length && /\s/.test(raw[start] ?? "")) {
        start += 1;
    }
    const startChar = raw[start];
    if (startChar !== "{" && startChar !== "[") {
        return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i += 1) {
        const char = raw[i];
        if (char === undefined) {
            break;
        }
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (char === "\\") {
                escaped = true;
            }
            else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{" || char === "[") {
            depth += 1;
            continue;
        }
        if (char === "}" || char === "]") {
            depth -= 1;
            if (depth === 0) {
                return raw.slice(start, i + 1);
            }
        }
    }
    return null;
}
const MAX_TOOLCALL_REPAIR_BUFFER_CHARS = 64_000;
const MAX_TOOLCALL_REPAIR_TRAILING_CHARS = 3;
const TOOLCALL_REPAIR_ALLOWED_TRAILING_RE = /^[^\s{}[\]":,\\]{1,3}$/;
function shouldAttemptMalformedToolCallRepair(partialJson, delta) {
    if (/[}\]]/.test(delta)) {
        return true;
    }
    const trimmedDelta = delta.trim();
    return (trimmedDelta.length > 0 &&
        trimmedDelta.length <= MAX_TOOLCALL_REPAIR_TRAILING_CHARS &&
        /[}\]]/.test(partialJson));
}
function tryParseMalformedToolCallArguments(raw) {
    if (!raw.trim()) {
        return undefined;
    }
    try {
        JSON.parse(raw);
        return undefined;
    }
    catch {
        const jsonPrefix = extractBalancedJsonPrefix(raw);
        if (!jsonPrefix) {
            return undefined;
        }
        const suffix = raw.slice(raw.indexOf(jsonPrefix) + jsonPrefix.length).trim();
        if (suffix.length === 0 ||
            suffix.length > MAX_TOOLCALL_REPAIR_TRAILING_CHARS ||
            !TOOLCALL_REPAIR_ALLOWED_TRAILING_RE.test(suffix)) {
            return undefined;
        }
        try {
            const parsed = JSON.parse(jsonPrefix);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? { args: parsed, trailingSuffix: suffix }
                : undefined;
        }
        catch {
            return undefined;
        }
    }
}
function repairToolCallArgumentsInMessage(message, contentIndex, repairedArgs) {
    if (!message || typeof message !== "object") {
        return;
    }
    const content = message.content;
    if (!Array.isArray(content)) {
        return;
    }
    const block = content[contentIndex];
    if (!block || typeof block !== "object") {
        return;
    }
    const typedBlock = block;
    if (!isToolCallBlockType(typedBlock.type)) {
        return;
    }
    typedBlock.arguments = repairedArgs;
}
function clearToolCallArgumentsInMessage(message, contentIndex) {
    if (!message || typeof message !== "object") {
        return;
    }
    const content = message.content;
    if (!Array.isArray(content)) {
        return;
    }
    const block = content[contentIndex];
    if (!block || typeof block !== "object") {
        return;
    }
    const typedBlock = block;
    if (!isToolCallBlockType(typedBlock.type)) {
        return;
    }
    typedBlock.arguments = {};
}
function repairMalformedToolCallArgumentsInMessage(message, repairedArgsByIndex) {
    if (!message || typeof message !== "object") {
        return;
    }
    const content = message.content;
    if (!Array.isArray(content)) {
        return;
    }
    for (const [index, repairedArgs] of repairedArgsByIndex.entries()) {
        repairToolCallArgumentsInMessage(message, index, repairedArgs);
    }
}
function wrapStreamRepairMalformedToolCallArguments(stream) {
    const partialJsonByIndex = new Map();
    const repairedArgsByIndex = new Map();
    const disabledIndices = new Set();
    const loggedRepairIndices = new Set();
    const originalResult = stream.result.bind(stream);
    stream.result = async () => {
        const message = await originalResult();
        repairMalformedToolCallArgumentsInMessage(message, repairedArgsByIndex);
        partialJsonByIndex.clear();
        repairedArgsByIndex.clear();
        disabledIndices.clear();
        loggedRepairIndices.clear();
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
                        if (typeof event.contentIndex === "number" &&
                            Number.isInteger(event.contentIndex) &&
                            event.type === "toolcall_delta" &&
                            typeof event.delta === "string") {
                            if (disabledIndices.has(event.contentIndex)) {
                                return result;
                            }
                            const nextPartialJson = (partialJsonByIndex.get(event.contentIndex) ?? "") + event.delta;
                            if (nextPartialJson.length > MAX_TOOLCALL_REPAIR_BUFFER_CHARS) {
                                partialJsonByIndex.delete(event.contentIndex);
                                repairedArgsByIndex.delete(event.contentIndex);
                                disabledIndices.add(event.contentIndex);
                                return result;
                            }
                            partialJsonByIndex.set(event.contentIndex, nextPartialJson);
                            if (shouldAttemptMalformedToolCallRepair(nextPartialJson, event.delta)) {
                                const repair = tryParseMalformedToolCallArguments(nextPartialJson);
                                if (repair) {
                                    repairedArgsByIndex.set(event.contentIndex, repair.args);
                                    repairToolCallArgumentsInMessage(event.partial, event.contentIndex, repair.args);
                                    repairToolCallArgumentsInMessage(event.message, event.contentIndex, repair.args);
                                    if (!loggedRepairIndices.has(event.contentIndex)) {
                                        loggedRepairIndices.add(event.contentIndex);
                                        log.warn(`repairing Kimi tool call arguments after ${repair.trailingSuffix.length} trailing chars`);
                                    }
                                }
                                else {
                                    repairedArgsByIndex.delete(event.contentIndex);
                                    clearToolCallArgumentsInMessage(event.partial, event.contentIndex);
                                    clearToolCallArgumentsInMessage(event.message, event.contentIndex);
                                }
                            }
                        }
                        if (typeof event.contentIndex === "number" &&
                            Number.isInteger(event.contentIndex) &&
                            event.type === "toolcall_end") {
                            const repairedArgs = repairedArgsByIndex.get(event.contentIndex);
                            if (repairedArgs) {
                                if (event.toolCall && typeof event.toolCall === "object") {
                                    event.toolCall.arguments = repairedArgs;
                                }
                                repairToolCallArgumentsInMessage(event.partial, event.contentIndex, repairedArgs);
                                repairToolCallArgumentsInMessage(event.message, event.contentIndex, repairedArgs);
                            }
                            partialJsonByIndex.delete(event.contentIndex);
                            disabledIndices.delete(event.contentIndex);
                            loggedRepairIndices.delete(event.contentIndex);
                        }
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
export function wrapStreamFnRepairMalformedToolCallArguments(baseFn) {
    return (model, context, options) => {
        const maybeStream = baseFn(model, context, options);
        if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
            return Promise.resolve(maybeStream).then((stream) => wrapStreamRepairMalformedToolCallArguments(stream));
        }
        return wrapStreamRepairMalformedToolCallArguments(maybeStream);
    };
}
export function shouldRepairMalformedAnthropicToolCallArguments(provider) {
    return normalizeProviderId(provider ?? "") === "kimi";
}
const HTML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/i;
function decodeHtmlEntities(value) {
    return value
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/gi, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}
export function decodeHtmlEntitiesInObject(obj) {
    if (typeof obj === "string") {
        return HTML_ENTITY_RE.test(obj) ? decodeHtmlEntities(obj) : obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(decodeHtmlEntitiesInObject);
    }
    if (obj && typeof obj === "object") {
        const result = {};
        for (const [key, val] of Object.entries(obj)) {
            result[key] = decodeHtmlEntitiesInObject(val);
        }
        return result;
    }
    return obj;
}
function decodeXaiToolCallArgumentsInMessage(message) {
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
        if (typedBlock.type !== "toolCall" || !typedBlock.arguments) {
            continue;
        }
        if (typeof typedBlock.arguments === "object") {
            typedBlock.arguments = decodeHtmlEntitiesInObject(typedBlock.arguments);
        }
    }
}
function wrapStreamDecodeXaiToolCallArguments(stream) {
    const originalResult = stream.result.bind(stream);
    stream.result = async () => {
        const message = await originalResult();
        decodeXaiToolCallArgumentsInMessage(message);
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
                        decodeXaiToolCallArgumentsInMessage(event.partial);
                        decodeXaiToolCallArgumentsInMessage(event.message);
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
export function wrapStreamFnDecodeXaiToolCallArguments(baseFn) {
    return (model, context, options) => {
        const maybeStream = baseFn(model, context, options);
        if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
            return Promise.resolve(maybeStream).then((stream) => wrapStreamDecodeXaiToolCallArguments(stream));
        }
        return wrapStreamDecodeXaiToolCallArguments(maybeStream);
    };
}
