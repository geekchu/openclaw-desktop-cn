import { normalizeChatChannelId } from "../channels/registry.js";
import { ensurePluginAllowlisted } from "../config/plugins-allowlist.js";
import { setPluginEnabledInConfig } from "./toggle-config.js";
export function enablePluginInConfig(cfg, pluginId) {
    const builtInChannelId = normalizeChatChannelId(pluginId);
    const resolvedId = builtInChannelId ?? pluginId;
    if (cfg.plugins?.enabled === false) {
        return { config: cfg, enabled: false, reason: "plugins disabled" };
    }
    if (cfg.plugins?.deny?.includes(pluginId) || cfg.plugins?.deny?.includes(resolvedId)) {
        return { config: cfg, enabled: false, reason: "blocked by denylist" };
    }
    let next = setPluginEnabledInConfig(cfg, resolvedId, true);
    next = ensurePluginAllowlisted(next, resolvedId);
    return { config: next, enabled: true };
}
