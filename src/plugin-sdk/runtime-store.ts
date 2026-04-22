export type { PluginRuntime } from "../plugins/runtime/types.js";

/**
 * Shared global map so that jiti-loaded (CJS-transpiled) and native-ESM
 * instances of the same runtime store module read/write the same slot.
 * Without this, on Windows (where jiti never uses native ESM) the
 * `setRuntime` call in the jiti context writes to a different closure
 * than the `getRuntime` call in native-ESM dynamic-import context.
 */
const GLOBAL_KEY = "__openclaw_plugin_runtime_stores__";
function getGlobalStoreMap(): Map<string, { runtime: unknown }> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, { runtime: unknown }>();
  }
  return g[GLOBAL_KEY] as Map<string, { runtime: unknown }>;
}

/** Create a tiny mutable runtime slot with strict access when the runtime has not been initialized. */
export function createPluginRuntimeStore<T>(errorMessage: string): {
  setRuntime: (next: T) => void;
  clearRuntime: () => void;
  tryGetRuntime: () => T | null;
  getRuntime: () => T;
} {
  const stores = getGlobalStoreMap();
  if (!stores.has(errorMessage)) {
    stores.set(errorMessage, { runtime: null });
  }
  const slot = stores.get(errorMessage)!;

  return {
    setRuntime(next: T) {
      slot.runtime = next;
    },
    clearRuntime() {
      slot.runtime = null;
    },
    tryGetRuntime() {
      return slot.runtime as T | null;
    },
    getRuntime() {
      if (!slot.runtime) {
        throw new Error(errorMessage);
      }
      return slot.runtime as T;
    },
  };
}
