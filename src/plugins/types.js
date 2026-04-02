export const PLUGIN_HOOK_NAMES = [
    "before_model_resolve",
    "before_prompt_build",
    "before_agent_start",
    "llm_input",
    "llm_output",
    "agent_end",
    "before_compaction",
    "after_compaction",
    "before_reset",
    "inbound_claim",
    "message_received",
    "message_sending",
    "message_sent",
    "before_tool_call",
    "after_tool_call",
    "tool_result_persist",
    "before_message_write",
    "session_start",
    "session_end",
    "subagent_spawning",
    "subagent_delivery_target",
    "subagent_spawned",
    "subagent_ended",
    "gateway_start",
    "gateway_stop",
    "before_dispatch",
];
const assertAllPluginHookNamesListed = true;
void assertAllPluginHookNamesListed;
const pluginHookNameSet = new Set(PLUGIN_HOOK_NAMES);
export const isPluginHookName = (hookName) => typeof hookName === "string" && pluginHookNameSet.has(hookName);
export const PROMPT_INJECTION_HOOK_NAMES = [
    "before_prompt_build",
    "before_agent_start",
];
const promptInjectionHookNameSet = new Set(PROMPT_INJECTION_HOOK_NAMES);
export const isPromptInjectionHookName = (hookName) => promptInjectionHookNameSet.has(hookName);
export const PLUGIN_PROMPT_MUTATION_RESULT_FIELDS = [
    "systemPrompt",
    "prependContext",
    "prependSystemContext",
    "appendSystemContext",
];
const assertAllPluginPromptMutationResultFieldsListed = true;
void assertAllPluginPromptMutationResultFieldsListed;
export const stripPromptMutationFieldsFromLegacyHookResult = (result) => {
    if (!result || typeof result !== "object") {
        return result;
    }
    const remaining = { ...result };
    for (const field of PLUGIN_PROMPT_MUTATION_RESULT_FIELDS) {
        delete remaining[field];
    }
    return Object.keys(remaining).length > 0
        ? remaining
        : undefined;
};
export const PluginApprovalResolutions = {
    ALLOW_ONCE: "allow-once",
    ALLOW_ALWAYS: "allow-always",
    DENY: "deny",
    TIMEOUT: "timeout",
    CANCELLED: "cancelled",
};
