import { DEFAULT_ACCOUNT_ID } from "../../routing/session-key.js";
function isConfiguredSecretValue(value) {
    if (typeof value === "string") {
        return value.trim().length > 0;
    }
    return Boolean(value);
}
export function setAccountEnabledInConfigSection(params) {
    const accountKey = params.accountId || DEFAULT_ACCOUNT_ID;
    const channels = params.cfg.channels;
    const base = channels?.[params.sectionKey];
    const hasAccounts = Boolean(base?.accounts);
    if (params.allowTopLevel && accountKey === DEFAULT_ACCOUNT_ID && !hasAccounts) {
        return {
            ...params.cfg,
            channels: {
                ...params.cfg.channels,
                [params.sectionKey]: {
                    ...base,
                    enabled: params.enabled,
                },
            },
        };
    }
    const baseAccounts = base?.accounts ?? {};
    const existing = baseAccounts[accountKey] ?? {};
    return {
        ...params.cfg,
        channels: {
            ...params.cfg.channels,
            [params.sectionKey]: {
                ...base,
                accounts: {
                    ...baseAccounts,
                    [accountKey]: {
                        ...existing,
                        enabled: params.enabled,
                    },
                },
            },
        },
    };
}
export function deleteAccountFromConfigSection(params) {
    const accountKey = params.accountId || DEFAULT_ACCOUNT_ID;
    const channels = params.cfg.channels;
    const base = channels?.[params.sectionKey];
    if (!base) {
        return params.cfg;
    }
    const baseAccounts = base.accounts && typeof base.accounts === "object" ? { ...base.accounts } : undefined;
    if (accountKey !== DEFAULT_ACCOUNT_ID) {
        const accounts = baseAccounts ? { ...baseAccounts } : {};
        delete accounts[accountKey];
        return {
            ...params.cfg,
            channels: {
                ...params.cfg.channels,
                [params.sectionKey]: {
                    ...base,
                    accounts: Object.keys(accounts).length ? accounts : undefined,
                },
            },
        };
    }
    if (baseAccounts && Object.keys(baseAccounts).length > 0) {
        delete baseAccounts[accountKey];
        const baseRecord = { ...base };
        for (const field of params.clearBaseFields ?? []) {
            if (field in baseRecord) {
                baseRecord[field] = undefined;
            }
        }
        return {
            ...params.cfg,
            channels: {
                ...params.cfg.channels,
                [params.sectionKey]: {
                    ...baseRecord,
                    accounts: Object.keys(baseAccounts).length ? baseAccounts : undefined,
                },
            },
        };
    }
    const nextChannels = { ...params.cfg.channels };
    delete nextChannels[params.sectionKey];
    const nextCfg = { ...params.cfg };
    if (Object.keys(nextChannels).length > 0) {
        nextCfg.channels = nextChannels;
    }
    else {
        delete nextCfg.channels;
    }
    return nextCfg;
}
export function clearAccountEntryFields(params) {
    const accountKey = params.accountId || DEFAULT_ACCOUNT_ID;
    const baseAccounts = params.accounts && typeof params.accounts === "object" ? { ...params.accounts } : undefined;
    if (!baseAccounts || !(accountKey in baseAccounts)) {
        return { nextAccounts: baseAccounts, changed: false, cleared: false };
    }
    const entry = baseAccounts[accountKey];
    if (!entry || typeof entry !== "object") {
        return { nextAccounts: baseAccounts, changed: false, cleared: false };
    }
    const nextEntry = { ...entry };
    const hasAnyField = params.fields.some((field) => field in nextEntry);
    if (!hasAnyField) {
        return { nextAccounts: baseAccounts, changed: false, cleared: false };
    }
    const isValueSet = params.isValueSet ?? isConfiguredSecretValue;
    let cleared = Boolean(params.markClearedOnFieldPresence);
    for (const field of params.fields) {
        if (!(field in nextEntry)) {
            continue;
        }
        if (isValueSet(nextEntry[field])) {
            cleared = true;
        }
        delete nextEntry[field];
    }
    if (Object.keys(nextEntry).length === 0) {
        delete baseAccounts[accountKey];
    }
    else {
        baseAccounts[accountKey] = nextEntry;
    }
    const nextAccounts = Object.keys(baseAccounts).length > 0 ? baseAccounts : undefined;
    return {
        nextAccounts,
        changed: true,
        cleared,
    };
}
