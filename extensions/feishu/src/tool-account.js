import { listFeishuAccountIds, resolveFeishuAccount, resolveFeishuRuntimeAccount, } from "./accounts.js";
import { createFeishuClient } from "./client.js";
import { resolveToolsConfig } from "./tools-config.js";
function normalizeOptionalAccountId(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function readConfiguredDefaultAccountId(config) {
    const value = config?.channels?.feishu
        ?.defaultAccount;
    if (typeof value !== "string") {
        return undefined;
    }
    return normalizeOptionalAccountId(value);
}
function resolveImplicitToolAccountId(params) {
    const explicitAccountId = normalizeOptionalAccountId(params.executeParams?.accountId);
    if (explicitAccountId) {
        return explicitAccountId;
    }
    const configuredDefaultAccountId = readConfiguredDefaultAccountId(params.api.config);
    if (configuredDefaultAccountId) {
        return configuredDefaultAccountId;
    }
    const contextualAccountId = normalizeOptionalAccountId(params.defaultAccountId);
    if (!contextualAccountId) {
        return undefined;
    }
    if (!listFeishuAccountIds(params.api.config).includes(contextualAccountId)) {
        return undefined;
    }
    const contextualAccount = resolveFeishuAccount({
        cfg: params.api.config,
        accountId: contextualAccountId,
    });
    return contextualAccount.enabled ? contextualAccountId : undefined;
}
export function resolveFeishuToolAccount(params) {
    if (!params.api.config) {
        throw new Error("Feishu config unavailable");
    }
    return resolveFeishuRuntimeAccount({
        cfg: params.api.config,
        accountId: resolveImplicitToolAccountId(params),
    });
}
export function createFeishuToolClient(params) {
    return createFeishuClient(resolveFeishuToolAccount(params));
}
export function resolveAnyEnabledFeishuToolsConfig(accounts) {
    const merged = {
        doc: false,
        chat: false,
        wiki: false,
        drive: false,
        perm: false,
        scopes: false,
    };
    for (const account of accounts) {
        const cfg = resolveToolsConfig(account.config.tools);
        merged.doc = merged.doc || cfg.doc;
        merged.chat = merged.chat || cfg.chat;
        merged.wiki = merged.wiki || cfg.wiki;
        merged.drive = merged.drive || cfg.drive;
        merged.perm = merged.perm || cfg.perm;
        merged.scopes = merged.scopes || cfg.scopes;
    }
    return merged;
}
