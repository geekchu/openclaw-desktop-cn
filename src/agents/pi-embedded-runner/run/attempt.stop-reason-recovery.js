import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { buildStreamErrorAssistantMessage } from "../../stream-message-shared.js";
const UNHANDLED_STOP_REASON_RE = /^Unhandled stop reason:\s*(.+)$/i;
function formatUnhandledStopReasonErrorMessage(stopReason) {
    return `The model stopped because the provider returned an unhandled stop reason: ${stopReason}. Please rephrase and try again.`;
}
function normalizeUnhandledStopReasonMessage(message) {
    if (typeof message !== "string") {
        return undefined;
    }
    const match = message.trim().match(UNHANDLED_STOP_REASON_RE);
    const stopReason = match?.[1]?.trim();
    if (!stopReason) {
        return undefined;
    }
    return formatUnhandledStopReasonErrorMessage(stopReason);
}
function patchUnhandledStopReasonInAssistantMessage(message) {
    if (!message || typeof message !== "object") {
        return;
    }
    const assistant = message;
    const normalizedMessage = normalizeUnhandledStopReasonMessage(assistant.errorMessage);
    if (!normalizedMessage) {
        return;
    }
    assistant.stopReason = "error";
    assistant.errorMessage = normalizedMessage;
}
function buildUnhandledStopReasonErrorStream(model, errorMessage) {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
        stream.push({
            type: "error",
            reason: "error",
            error: buildStreamErrorAssistantMessage({
                model: {
                    api: model.api,
                    provider: model.provider,
                    id: model.id,
                },
                errorMessage,
            }),
        });
        stream.end();
    });
    return stream;
}
function wrapStreamHandleUnhandledStopReason(model, stream) {
    const originalResult = stream.result.bind(stream);
    stream.result = async () => {
        try {
            const message = await originalResult();
            patchUnhandledStopReasonInAssistantMessage(message);
            return message;
        }
        catch (err) {
            const normalizedMessage = normalizeUnhandledStopReasonMessage(err instanceof Error ? err.message : String(err));
            if (!normalizedMessage) {
                throw err;
            }
            return buildStreamErrorAssistantMessage({
                model: {
                    api: model.api,
                    provider: model.provider,
                    id: model.id,
                },
                errorMessage: normalizedMessage,
            });
        }
    };
    const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
    stream[Symbol.asyncIterator] =
        function () {
            const iterator = originalAsyncIterator();
            let emittedSyntheticTerminal = false;
            return {
                async next() {
                    if (emittedSyntheticTerminal) {
                        return { done: true, value: undefined };
                    }
                    try {
                        const result = await iterator.next();
                        if (!result.done && result.value && typeof result.value === "object") {
                            const event = result.value;
                            patchUnhandledStopReasonInAssistantMessage(event.error);
                        }
                        return result;
                    }
                    catch (err) {
                        const normalizedMessage = normalizeUnhandledStopReasonMessage(err instanceof Error ? err.message : String(err));
                        if (!normalizedMessage) {
                            throw err;
                        }
                        emittedSyntheticTerminal = true;
                        return {
                            done: false,
                            value: {
                                type: "error",
                                reason: "error",
                                error: buildStreamErrorAssistantMessage({
                                    model: {
                                        api: model.api,
                                        provider: model.provider,
                                        id: model.id,
                                    },
                                    errorMessage: normalizedMessage,
                                }),
                            },
                        };
                    }
                },
                async return(value) {
                    return iterator.return?.(value) ?? { done: true, value: undefined };
                },
                async throw(error) {
                    return iterator.throw?.(error) ?? { done: true, value: undefined };
                },
                [Symbol.asyncIterator]() {
                    return this;
                },
            };
        };
    return stream;
}
export function wrapStreamFnHandleSensitiveStopReason(baseFn) {
    return (model, context, options) => {
        try {
            const maybeStream = baseFn(model, context, options);
            if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
                return Promise.resolve(maybeStream).then((stream) => wrapStreamHandleUnhandledStopReason(model, stream), (err) => {
                    const normalizedMessage = normalizeUnhandledStopReasonMessage(err instanceof Error ? err.message : String(err));
                    if (!normalizedMessage) {
                        throw err;
                    }
                    return buildUnhandledStopReasonErrorStream(model, normalizedMessage);
                });
            }
            return wrapStreamHandleUnhandledStopReason(model, maybeStream);
        }
        catch (err) {
            const normalizedMessage = normalizeUnhandledStopReasonMessage(err instanceof Error ? err.message : String(err));
            if (!normalizedMessage) {
                throw err;
            }
            return buildUnhandledStopReasonErrorStream(model, normalizedMessage);
        }
    };
}
