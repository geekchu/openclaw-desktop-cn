import { isRecord } from "../../../utils.js";
export { isRecord };
export function asString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
export function formatMatchMetadata(params) {
    const matchKey = typeof params.matchKey === "string"
        ? params.matchKey
        : typeof params.matchKey === "number"
            ? String(params.matchKey)
            : undefined;
    const matchSource = asString(params.matchSource);
    const parts = [
        matchKey ? `matchKey=${matchKey}` : null,
        matchSource ? `matchSource=${matchSource}` : null,
    ].filter((entry) => Boolean(entry));
    return parts.length > 0 ? parts.join(" ") : undefined;
}
export function appendMatchMetadata(message, params) {
    const meta = formatMatchMetadata(params);
    return meta ? `${message} (${meta})` : message;
}
export function resolveEnabledConfiguredAccountId(account) {
    const accountId = asString(account.accountId) ?? "default";
    const enabled = account.enabled !== false;
    const configured = account.configured === true;
    return enabled && configured ? accountId : null;
}
export function collectIssuesForEnabledAccounts(params) {
    const issues = [];
    for (const entry of params.accounts) {
        const account = params.readAccount(entry);
        if (!account || account.enabled === false) {
            continue;
        }
        const accountId = asString(account.accountId) ?? "default";
        params.collectIssues({ account, accountId, issues });
    }
    return issues;
}
