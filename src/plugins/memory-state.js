const memoryPluginState = {};
export function registerMemoryPromptSection(builder) {
    memoryPluginState.promptBuilder = builder;
}
export function buildMemoryPromptSection(params) {
    return memoryPluginState.promptBuilder?.(params) ?? [];
}
export function getMemoryPromptSectionBuilder() {
    return memoryPluginState.promptBuilder;
}
export function registerMemoryFlushPlanResolver(resolver) {
    memoryPluginState.flushPlanResolver = resolver;
}
export function resolveMemoryFlushPlan(params) {
    return memoryPluginState.flushPlanResolver?.(params) ?? null;
}
export function getMemoryFlushPlanResolver() {
    return memoryPluginState.flushPlanResolver;
}
export function registerMemoryRuntime(runtime) {
    memoryPluginState.runtime = runtime;
}
export function getMemoryRuntime() {
    return memoryPluginState.runtime;
}
export function hasMemoryRuntime() {
    return memoryPluginState.runtime !== undefined;
}
export function restoreMemoryPluginState(state) {
    memoryPluginState.promptBuilder = state.promptBuilder;
    memoryPluginState.flushPlanResolver = state.flushPlanResolver;
    memoryPluginState.runtime = state.runtime;
}
export function clearMemoryPluginState() {
    memoryPluginState.promptBuilder = undefined;
    memoryPluginState.flushPlanResolver = undefined;
    memoryPluginState.runtime = undefined;
}
export const _resetMemoryPluginState = clearMemoryPluginState;
