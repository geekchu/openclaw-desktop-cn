import { discordSetupAdapter } from "./setup-core.js";
import { createDiscordPluginBase } from "./shared.js";
export const discordSetupPlugin = {
    ...createDiscordPluginBase({
        setup: discordSetupAdapter,
    }),
};
