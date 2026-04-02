import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
function normalizePatch(patch, onlyDefinedFields) {
    if (!onlyDefinedFields) {
        return patch;
    }
    const next = {};
    if (patch.serverUrl !== undefined) {
        next.serverUrl = patch.serverUrl;
    }
    if (patch.password !== undefined) {
        next.password = patch.password;
    }
    if (patch.webhookPath !== undefined) {
        next.webhookPath = patch.webhookPath;
    }
    return next;
}
export function applyBlueBubblesConnectionConfig(params) {
    const patch = normalizePatch(params.patch, params.onlyDefinedFields === true);
    if (params.accountId === DEFAULT_ACCOUNT_ID) {
        return {
            ...params.cfg,
            channels: {
                ...params.cfg.channels,
                bluebubbles: {
                    ...params.cfg.channels?.bluebubbles,
                    enabled: true,
                    ...patch,
                },
            },
        };
    }
    const currentAccount = params.cfg.channels?.bluebubbles?.accounts?.[params.accountId];
    const enabled = params.accountEnabled === "preserve-or-true"
        ? (currentAccount?.enabled ?? true)
        : (params.accountEnabled ?? true);
    return {
        ...params.cfg,
        channels: {
            ...params.cfg.channels,
            bluebubbles: {
                ...params.cfg.channels?.bluebubbles,
                enabled: true,
                accounts: {
                    ...params.cfg.channels?.bluebubbles?.accounts,
                    [params.accountId]: {
                        ...currentAccount,
                        enabled,
                        ...patch,
                    },
                },
            },
        },
    };
}
