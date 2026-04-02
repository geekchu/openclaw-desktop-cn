import { createNonExitingRuntime } from "openclaw/plugin-sdk/runtime-env";
import { normalizeStringEntries } from "openclaw/plugin-sdk/text-runtime";
export function resolveRuntime(opts) {
    return opts.runtime ?? createNonExitingRuntime();
}
export function normalizeAllowList(list) {
    return normalizeStringEntries(list);
}
