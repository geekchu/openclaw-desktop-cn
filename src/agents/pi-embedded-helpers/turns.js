/**
 * Strips dangling tool_use blocks from assistant messages when the immediately
 * following user message does not contain a matching tool_result block.
 * This fixes the "tool_use ids found without tool_result blocks" error from Anthropic.
 */
function stripDanglingAnthropicToolUses(messages) {
    const result = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg || typeof msg !== "object") {
            result.push(msg);
            continue;
        }
        const msgRole = msg.role;
        if (msgRole !== "assistant") {
            result.push(msg);
            continue;
        }
        const assistantMsg = msg;
        // Get the next message to check for tool_result blocks
        const nextMsg = messages[i + 1];
        const nextMsgRole = nextMsg && typeof nextMsg === "object"
            ? nextMsg.role
            : undefined;
        // If next message is not user, keep the assistant message as-is
        if (nextMsgRole !== "user") {
            result.push(msg);
            continue;
        }
        // Collect tool_use_ids from the next user message's tool_result blocks
        const nextUserMsg = nextMsg;
        const validToolUseIds = new Set();
        if (Array.isArray(nextUserMsg.content)) {
            for (const block of nextUserMsg.content) {
                if (block && block.type === "toolResult" && block.toolUseId) {
                    validToolUseIds.add(block.toolUseId);
                }
            }
        }
        // Filter out tool_use blocks that don't have matching tool_result
        const originalContent = Array.isArray(assistantMsg.content) ? assistantMsg.content : [];
        const filteredContent = originalContent.filter((block) => {
            if (!block) {
                return false;
            }
            if (block.type !== "toolUse") {
                return true;
            }
            // Keep tool_use if its id is in the valid set
            return validToolUseIds.has(block.id || "");
        });
        // If all content would be removed, insert a minimal fallback text block
        if (originalContent.length > 0 && filteredContent.length === 0) {
            result.push({
                ...assistantMsg,
                content: [{ type: "text", text: "[tool calls omitted]" }],
            });
        }
        else {
            result.push({
                ...assistantMsg,
                content: filteredContent,
            });
        }
    }
    return result;
}
function validateTurnsWithConsecutiveMerge(params) {
    const { messages, role, merge } = params;
    if (!Array.isArray(messages) || messages.length === 0) {
        return messages;
    }
    const result = [];
    let lastRole;
    for (const msg of messages) {
        if (!msg || typeof msg !== "object") {
            result.push(msg);
            continue;
        }
        const msgRole = msg.role;
        if (!msgRole) {
            result.push(msg);
            continue;
        }
        if (msgRole === lastRole && lastRole === role) {
            const lastMsg = result[result.length - 1];
            const currentMsg = msg;
            if (lastMsg && typeof lastMsg === "object") {
                const lastTyped = lastMsg;
                result[result.length - 1] = merge(lastTyped, currentMsg);
                continue;
            }
        }
        result.push(msg);
        lastRole = msgRole;
    }
    return result;
}
function mergeConsecutiveAssistantTurns(previous, current) {
    const mergedContent = [
        ...(Array.isArray(previous.content) ? previous.content : []),
        ...(Array.isArray(current.content) ? current.content : []),
    ];
    return {
        ...previous,
        content: mergedContent,
        ...(current.usage && { usage: current.usage }),
        ...(current.stopReason && { stopReason: current.stopReason }),
        ...(current.errorMessage && {
            errorMessage: current.errorMessage,
        }),
    };
}
/**
 * Validates and fixes conversation turn sequences for Gemini API.
 * Gemini requires strict alternating user→assistant→tool→user pattern.
 * Merges consecutive assistant messages together.
 */
export function validateGeminiTurns(messages) {
    return validateTurnsWithConsecutiveMerge({
        messages,
        role: "assistant",
        merge: mergeConsecutiveAssistantTurns,
    });
}
export function mergeConsecutiveUserTurns(previous, current) {
    const mergedContent = [
        ...(Array.isArray(previous.content) ? previous.content : []),
        ...(Array.isArray(current.content) ? current.content : []),
    ];
    return {
        ...current,
        content: mergedContent,
        timestamp: current.timestamp ?? previous.timestamp,
    };
}
/**
 * Validates and fixes conversation turn sequences for Anthropic API.
 * Anthropic requires strict alternating user→assistant pattern.
 * Merges consecutive user messages together.
 * Also strips dangling tool_use blocks that lack corresponding tool_result blocks.
 */
export function validateAnthropicTurns(messages) {
    // First, strip dangling tool_use blocks from assistant messages
    const stripped = stripDanglingAnthropicToolUses(messages);
    return validateTurnsWithConsecutiveMerge({
        messages: stripped,
        role: "user",
        merge: mergeConsecutiveUserTurns,
    });
}
