import { normalizePluginsConfig, resolveEffectiveEnableState, } from "openclaw/plugin-sdk/browser-support";
export function isDefaultBrowserPluginEnabled(cfg) {
    return resolveEffectiveEnableState({
        id: "browser",
        origin: "bundled",
        config: normalizePluginsConfig(cfg.plugins),
        rootConfig: cfg,
        enabledByDefault: true,
    }).enabled;
}
