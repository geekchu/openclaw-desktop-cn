import { createRequire } from "node:module";
export const TEST_UNDICI_RUNTIME_DEPS_KEY = "__OPENCLAW_TEST_UNDICI_RUNTIME_DEPS__";
function isUndiciRuntimeDeps(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.Agent === "function" &&
        typeof value.EnvHttpProxyAgent === "function" &&
        typeof value.ProxyAgent === "function");
}
export function loadUndiciRuntimeDeps() {
    const override = globalThis[TEST_UNDICI_RUNTIME_DEPS_KEY];
    if (isUndiciRuntimeDeps(override)) {
        return override;
    }
    const require = createRequire(import.meta.url);
    const undici = require("undici");
    return {
        Agent: undici.Agent,
        EnvHttpProxyAgent: undici.EnvHttpProxyAgent,
        ProxyAgent: undici.ProxyAgent,
    };
}
