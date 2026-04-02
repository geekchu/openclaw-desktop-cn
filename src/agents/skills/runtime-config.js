import { getRuntimeConfigSnapshot } from "../../config/config.js";
export function resolveSkillRuntimeConfig(config) {
    return getRuntimeConfigSnapshot() ?? config;
}
