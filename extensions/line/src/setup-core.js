import { createSetupInputPresenceValidator } from "openclaw/plugin-sdk/setup";
import { hasLineCredentials, parseLineAllowFromId } from "./account-helpers.js";
import { DEFAULT_ACCOUNT_ID, listLineAccountIds, normalizeAccountId, resolveLineAccount, } from "./setup-runtime-api.js";
const channel = "line";
export function patchLineAccountConfig(params) {
    const accountId = normalizeAccountId(params.accountId);
    const lineConfig = (params.cfg.channels?.line ?? {});
    const clearFields = params.clearFields ?? [];
    if (accountId === DEFAULT_ACCOUNT_ID) {
        const nextLine = { ...lineConfig };
        for (const field of clearFields) {
            delete nextLine[field];
        }
        return {
            ...params.cfg,
            channels: {
                ...params.cfg.channels,
                line: {
                    ...nextLine,
                    ...(params.enabled ? { enabled: true } : {}),
                    ...params.patch,
                },
            },
        };
    }
    const nextAccount = {
        ...(lineConfig.accounts?.[accountId] ?? {}),
    };
    for (const field of clearFields) {
        delete nextAccount[field];
    }
    return {
        ...params.cfg,
        channels: {
            ...params.cfg.channels,
            line: {
                ...lineConfig,
                ...(params.enabled ? { enabled: true } : {}),
                accounts: {
                    ...lineConfig.accounts,
                    [accountId]: {
                        ...nextAccount,
                        ...(params.enabled ? { enabled: true } : {}),
                        ...params.patch,
                    },
                },
            },
        },
    };
}
export function isLineConfigured(cfg, accountId) {
    return hasLineCredentials(resolveLineAccount({ cfg, accountId }));
}
export { parseLineAllowFromId };
export const lineSetupAdapter = {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) => patchLineAccountConfig({
        cfg,
        accountId,
        patch: name?.trim() ? { name: name.trim() } : {},
    }),
    validateInput: createSetupInputPresenceValidator({
        defaultAccountOnlyEnvError: "LINE_CHANNEL_ACCESS_TOKEN can only be used for the default account.",
        whenNotUseEnv: [
            {
                someOf: ["channelAccessToken", "tokenFile"],
                message: "LINE requires channelAccessToken or --token-file (or --use-env).",
            },
            {
                someOf: ["channelSecret", "secretFile"],
                message: "LINE requires channelSecret or --secret-file (or --use-env).",
            },
        ],
    }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
        const typedInput = input;
        const normalizedAccountId = normalizeAccountId(accountId);
        if (normalizedAccountId === DEFAULT_ACCOUNT_ID) {
            return patchLineAccountConfig({
                cfg,
                accountId: normalizedAccountId,
                enabled: true,
                clearFields: typedInput.useEnv
                    ? ["channelAccessToken", "channelSecret", "tokenFile", "secretFile"]
                    : undefined,
                patch: typedInput.useEnv
                    ? {}
                    : {
                        ...(typedInput.tokenFile
                            ? { tokenFile: typedInput.tokenFile }
                            : typedInput.channelAccessToken
                                ? { channelAccessToken: typedInput.channelAccessToken }
                                : {}),
                        ...(typedInput.secretFile
                            ? { secretFile: typedInput.secretFile }
                            : typedInput.channelSecret
                                ? { channelSecret: typedInput.channelSecret }
                                : {}),
                    },
            });
        }
        return patchLineAccountConfig({
            cfg,
            accountId: normalizedAccountId,
            enabled: true,
            patch: {
                ...(typedInput.tokenFile
                    ? { tokenFile: typedInput.tokenFile }
                    : typedInput.channelAccessToken
                        ? { channelAccessToken: typedInput.channelAccessToken }
                        : {}),
                ...(typedInput.secretFile
                    ? { secretFile: typedInput.secretFile }
                    : typedInput.channelSecret
                        ? { channelSecret: typedInput.channelSecret }
                        : {}),
            },
        });
    },
};
export { listLineAccountIds };
