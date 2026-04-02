import { logDebug, logError } from "../logger.js";
import { isPlainObject } from "../utils.js";
import { isToolWrappedWithBeforeToolCallHook, runBeforeToolCallHook, } from "./pi-tools.before-tool-call.js";
import { normalizeToolName } from "./tool-policy.js";
import { jsonResult, payloadTextResult } from "./tools/common.js";
function isAbortSignal(value) {
    return typeof value === "object" && value !== null && "aborted" in value;
}
function isLegacyToolExecuteArgs(args) {
    const third = args[2];
    const fifth = args[4];
    if (typeof third === "function") {
        return true;
    }
    return isAbortSignal(fifth);
}
function describeToolExecutionError(err) {
    if (err instanceof Error) {
        const message = err.message?.trim() ? err.message : String(err);
        return { message, stack: err.stack };
    }
    return { message: String(err) };
}
function normalizeToolExecutionResult(params) {
    const { toolName, result } = params;
    if (result && typeof result === "object") {
        const record = result;
        if (Array.isArray(record.content)) {
            return result;
        }
        logDebug(`tools: ${toolName} returned non-standard result (missing content[]); coercing`);
        const details = "details" in record ? record.details : record;
        const safeDetails = details ?? { status: "ok", tool: toolName };
        return payloadTextResult(safeDetails);
    }
    const safeDetails = result ?? { status: "ok", tool: toolName };
    return payloadTextResult(safeDetails);
}
function buildToolExecutionErrorResult(params) {
    return jsonResult({
        status: "error",
        tool: params.toolName,
        error: params.message,
    });
}
function splitToolExecuteArgs(args) {
    if (isLegacyToolExecuteArgs(args)) {
        const [toolCallId, params, onUpdate, _ctx, signal] = args;
        return {
            toolCallId,
            params,
            onUpdate,
            signal,
        };
    }
    const [toolCallId, params, signal, onUpdate] = args;
    return {
        toolCallId,
        params,
        onUpdate,
        signal,
    };
}
export function toToolDefinitions(tools) {
    return tools.map((tool) => {
        const name = tool.name || "tool";
        const normalizedName = normalizeToolName(name);
        const beforeHookWrapped = isToolWrappedWithBeforeToolCallHook(tool);
        return {
            name,
            label: tool.label ?? name,
            description: tool.description ?? "",
            parameters: tool.parameters,
            execute: async (...args) => {
                const { toolCallId, params, onUpdate, signal } = splitToolExecuteArgs(args);
                let executeParams = params;
                try {
                    if (!beforeHookWrapped) {
                        const hookOutcome = await runBeforeToolCallHook({
                            toolName: name,
                            params,
                            toolCallId,
                        });
                        if (hookOutcome.blocked) {
                            throw new Error(hookOutcome.reason);
                        }
                        executeParams = hookOutcome.params;
                    }
                    const rawResult = await tool.execute(toolCallId, executeParams, signal, onUpdate);
                    const result = normalizeToolExecutionResult({
                        toolName: normalizedName,
                        result: rawResult,
                    });
                    return result;
                }
                catch (err) {
                    if (signal?.aborted) {
                        throw err;
                    }
                    const name = err && typeof err === "object" && "name" in err
                        ? String(err.name)
                        : "";
                    if (name === "AbortError") {
                        throw err;
                    }
                    const described = describeToolExecutionError(err);
                    if (described.stack && described.stack !== described.message) {
                        logDebug(`tools: ${normalizedName} failed stack:\n${described.stack}`);
                    }
                    logError(`[tools] ${normalizedName} failed: ${described.message}`);
                    return buildToolExecutionErrorResult({
                        toolName: normalizedName,
                        message: described.message,
                    });
                }
            },
        };
    });
}
// Convert client tools (OpenResponses hosted tools) to ToolDefinition format
// These tools are intercepted to return a "pending" result instead of executing
export function toClientToolDefinitions(tools, onClientToolCall, hookContext) {
    return tools.map((tool) => {
        const func = tool.function;
        return {
            name: func.name,
            label: func.name,
            description: func.description ?? "",
            parameters: func.parameters,
            execute: async (...args) => {
                const { toolCallId, params } = splitToolExecuteArgs(args);
                const outcome = await runBeforeToolCallHook({
                    toolName: func.name,
                    params,
                    toolCallId,
                    ctx: hookContext,
                });
                if (outcome.blocked) {
                    throw new Error(outcome.reason);
                }
                const adjustedParams = outcome.params;
                const paramsRecord = isPlainObject(adjustedParams) ? adjustedParams : {};
                // Notify handler that a client tool was called
                if (onClientToolCall) {
                    onClientToolCall(func.name, paramsRecord);
                }
                // Return a pending result - the client will execute this tool
                return jsonResult({
                    status: "pending",
                    tool: func.name,
                    message: "Tool execution delegated to client",
                });
            },
        };
    });
}
