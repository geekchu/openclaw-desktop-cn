export function hasLineCredentials(account) {
    return Boolean(account.channelAccessToken?.trim() && account.channelSecret?.trim());
}
export function parseLineAllowFromId(raw) {
    const trimmed = raw.trim().replace(/^line:(?:user:)?/i, "");
    if (!/^U[a-f0-9]{32}$/i.test(trimmed)) {
        return null;
    }
    return trimmed;
}
