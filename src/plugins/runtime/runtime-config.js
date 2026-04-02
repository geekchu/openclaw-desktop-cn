import { loadConfig, writeConfigFile } from "../../config/config.js";
export function createRuntimeConfig() {
    return {
        loadConfig,
        writeConfigFile,
    };
}
