import { getActivePluginRegistry } from "./runtime.js";
export function resolveRuntimeCliBackends() {
    return (getActivePluginRegistry()?.cliBackends ?? []).map((entry) => ({
        ...entry.backend,
        pluginId: entry.pluginId,
    }));
}
