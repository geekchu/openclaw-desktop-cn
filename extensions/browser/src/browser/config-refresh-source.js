import { createConfigIO, getRuntimeConfigSnapshot } from "../config/config.js";
export function loadBrowserConfigForRuntimeRefresh() {
    return getRuntimeConfigSnapshot() ?? createConfigIO().loadConfig();
}
