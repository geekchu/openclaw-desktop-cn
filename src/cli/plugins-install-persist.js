import { writeConfigFile } from "../config/config.js";
import { recordHookInstall } from "../hooks/installs.js";
import { enablePluginInConfig } from "../plugins/enable.js";
import { recordPluginInstall } from "../plugins/installs.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { applySlotSelectionForPlugin, enableInternalHookEntries, logHookPackRestartHint, logSlotWarnings, } from "./plugins-command-helpers.js";
export async function persistPluginInstall(params) {
    let next = enablePluginInConfig(params.config, params.pluginId).config;
    next = recordPluginInstall(next, {
        pluginId: params.pluginId,
        ...params.install,
    });
    const slotResult = applySlotSelectionForPlugin(next, params.pluginId);
    next = slotResult.config;
    await writeConfigFile(next);
    logSlotWarnings(slotResult.warnings);
    if (params.warningMessage) {
        defaultRuntime.log(theme.warn(params.warningMessage));
    }
    defaultRuntime.log(params.successMessage ?? `Installed plugin: ${params.pluginId}`);
    defaultRuntime.log("Restart the gateway to load plugins.");
    return next;
}
export async function persistHookPackInstall(params) {
    let next = enableInternalHookEntries(params.config, params.hooks);
    next = recordHookInstall(next, {
        hookId: params.hookPackId,
        hooks: params.hooks,
        ...params.install,
    });
    await writeConfigFile(next);
    defaultRuntime.log(params.successMessage ?? `Installed hook pack: ${params.hookPackId}`);
    logHookPackRestartHint();
    return next;
}
