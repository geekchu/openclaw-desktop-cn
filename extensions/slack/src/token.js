import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
export function normalizeSlackToken(raw) {
    return normalizeResolvedSecretInputString({
        value: raw,
        path: "channels.slack.*.token",
    });
}
export function resolveSlackBotToken(raw, path = "channels.slack.botToken") {
    return normalizeResolvedSecretInputString({ value: raw, path });
}
export function resolveSlackAppToken(raw, path = "channels.slack.appToken") {
    return normalizeResolvedSecretInputString({ value: raw, path });
}
export function resolveSlackUserToken(raw, path = "channels.slack.userToken") {
    return normalizeResolvedSecretInputString({ value: raw, path });
}
