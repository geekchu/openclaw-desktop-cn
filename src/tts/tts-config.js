export { normalizeTtsAutoMode } from "./tts-auto-mode.js";
export function resolveConfiguredTtsMode(cfg) {
    return cfg.messages?.tts?.mode ?? "final";
}
