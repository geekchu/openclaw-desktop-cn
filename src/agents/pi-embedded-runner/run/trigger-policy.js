const DEFAULT_EMBEDDED_RUN_TRIGGER_POLICY = {
    injectHeartbeatPrompt: true,
};
const EMBEDDED_RUN_TRIGGER_POLICY = {
    cron: {
        injectHeartbeatPrompt: false,
    },
};
export function shouldInjectHeartbeatPromptForTrigger(trigger) {
    return ((trigger ? EMBEDDED_RUN_TRIGGER_POLICY[trigger] : undefined)?.injectHeartbeatPrompt ??
        DEFAULT_EMBEDDED_RUN_TRIGGER_POLICY.injectHeartbeatPrompt);
}
