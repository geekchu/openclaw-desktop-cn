import { normalizeAccountId, resolveMergedAccountConfig, } from "openclaw/plugin-sdk/account-resolution";
import { evaluateSenderGroupAccessForPolicy } from "../runtime-api.js";
import { normalizeFeishuTarget } from "./targets.js";
function normalizeFeishuAllowEntry(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed === "*") {
        return "*";
    }
    const withoutProviderPrefix = trimmed.replace(/^feishu:/i, "");
    const normalized = normalizeFeishuTarget(withoutProviderPrefix) ?? withoutProviderPrefix;
    return normalized.trim().toLowerCase();
}
export function resolveFeishuAllowlistMatch(params) {
    const allowFrom = params.allowFrom
        .map((entry) => normalizeFeishuAllowEntry(String(entry)))
        .filter(Boolean);
    if (allowFrom.length === 0) {
        return { allowed: false };
    }
    if (allowFrom.includes("*")) {
        return { allowed: true, matchKey: "*", matchSource: "wildcard" };
    }
    // Feishu allowlists are ID-based; mutable display names must never grant access.
    const senderCandidates = [params.senderId, ...(params.senderIds ?? [])]
        .map((entry) => normalizeFeishuAllowEntry(String(entry ?? "")))
        .filter(Boolean);
    for (const senderId of senderCandidates) {
        if (allowFrom.includes(senderId)) {
            return { allowed: true, matchKey: senderId, matchSource: "id" };
        }
    }
    return { allowed: false };
}
export function resolveFeishuGroupConfig(params) {
    const groups = params.cfg?.groups ?? {};
    const wildcard = groups["*"];
    const groupId = params.groupId?.trim();
    if (!groupId) {
        return undefined;
    }
    const direct = groups[groupId];
    if (direct) {
        return direct;
    }
    const lowered = groupId.toLowerCase();
    const matchKey = Object.keys(groups).find((key) => key.toLowerCase() === lowered);
    if (matchKey) {
        return groups[matchKey];
    }
    return wildcard;
}
export function resolveFeishuGroupToolPolicy(params) {
    const cfg = params.cfg.channels?.feishu;
    if (!cfg) {
        return undefined;
    }
    const groupConfig = resolveFeishuGroupConfig({
        cfg,
        groupId: params.groupId,
    });
    return groupConfig?.tools;
}
export function isFeishuGroupAllowed(params) {
    return evaluateSenderGroupAccessForPolicy({
        groupPolicy: params.groupPolicy === "allowall" ? "open" : params.groupPolicy,
        groupAllowFrom: params.allowFrom.map((entry) => String(entry)),
        senderId: params.senderId,
        isSenderAllowed: () => resolveFeishuAllowlistMatch(params).allowed,
    }).allowed;
}
export function resolveFeishuReplyPolicy(params) {
    if (params.isDirectMessage) {
        return { requireMention: false };
    }
    const feishuCfg = params.cfg.channels?.feishu;
    const resolvedCfg = resolveMergedAccountConfig({
        channelConfig: feishuCfg,
        accounts: feishuCfg?.accounts,
        accountId: normalizeAccountId(params.accountId),
        normalizeAccountId,
        omitKeys: ["defaultAccount"],
    });
    const groupRequireMention = resolveFeishuGroupConfig({
        cfg: resolvedCfg,
        groupId: params.groupId,
    })?.requireMention;
    return {
        requireMention: typeof groupRequireMention === "boolean"
            ? groupRequireMention
            : typeof resolvedCfg.requireMention === "boolean"
                ? resolvedCfg.requireMention
                : params.groupPolicy === "open"
                    ? false
                    : true,
    };
}
