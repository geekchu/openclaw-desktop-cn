import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
const activeClients = new Map();
function resolveAccountKey(accountId) {
    const normalized = normalizeAccountId(accountId);
    return normalized || DEFAULT_ACCOUNT_ID;
}
export function setActiveMatrixClient(client, accountId) {
    const key = resolveAccountKey(accountId);
    if (!client) {
        activeClients.delete(key);
        return;
    }
    activeClients.set(key, client);
}
export function getActiveMatrixClient(accountId) {
    const key = resolveAccountKey(accountId);
    return activeClients.get(key) ?? null;
}
