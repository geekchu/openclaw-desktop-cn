import { createRequire } from "node:module";
let cachedDiscordVoiceSdk = null;
export function loadDiscordVoiceSdk() {
    if (cachedDiscordVoiceSdk) {
        return cachedDiscordVoiceSdk;
    }
    const req = createRequire(import.meta.url);
    cachedDiscordVoiceSdk = req("@discordjs/voice");
    return cachedDiscordVoiceSdk;
}
