import { listDirectoryGroupEntriesFromMapKeysAndAllowFrom, listDirectoryUserEntriesFromAllowFromAndMapKeys, } from "openclaw/plugin-sdk/directory-runtime";
import { resolveFeishuAccount } from "./accounts.js";
import { normalizeFeishuTarget } from "./targets.js";
function toFeishuDirectoryPeers(ids) {
    return ids.map((id) => ({ kind: "user", id }));
}
function toFeishuDirectoryGroups(ids) {
    return ids.map((id) => ({ kind: "group", id }));
}
export async function listFeishuDirectoryPeers(params) {
    const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });
    const entries = listDirectoryUserEntriesFromAllowFromAndMapKeys({
        allowFrom: account.config.allowFrom,
        map: account.config.dms,
        query: params.query,
        limit: params.limit,
        normalizeAllowFromId: (entry) => normalizeFeishuTarget(entry) ?? entry,
        normalizeMapKeyId: (entry) => normalizeFeishuTarget(entry) ?? entry,
    });
    return toFeishuDirectoryPeers(entries.map((entry) => entry.id));
}
export async function listFeishuDirectoryGroups(params) {
    const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });
    const entries = listDirectoryGroupEntriesFromMapKeysAndAllowFrom({
        groups: account.config.groups,
        allowFrom: account.config.groupAllowFrom,
        query: params.query,
        limit: params.limit,
    });
    return toFeishuDirectoryGroups(entries.map((entry) => entry.id));
}
