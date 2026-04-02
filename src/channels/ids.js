// Keep built-in channel IDs in a leaf module so shared config/sandbox code can
// reference them without importing channel registry helpers that may pull in
// plugin runtime state.
export const CHAT_CHANNEL_ORDER = [
    "telegram",
    "whatsapp",
    "discord",
    "irc",
    "googlechat",
    "slack",
    "signal",
    "imessage",
    "line",
];
export const CHANNEL_IDS = [...CHAT_CHANNEL_ORDER];
