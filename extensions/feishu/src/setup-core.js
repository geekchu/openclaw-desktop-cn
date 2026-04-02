import { DEFAULT_ACCOUNT_ID, } from "openclaw/plugin-sdk/setup";
export function setFeishuNamedAccountEnabled(cfg, accountId, enabled) {
    const feishuCfg = cfg.channels?.feishu;
    return {
        ...cfg,
        channels: {
            ...cfg.channels,
            feishu: {
                ...feishuCfg,
                accounts: {
                    ...feishuCfg?.accounts,
                    [accountId]: {
                        ...feishuCfg?.accounts?.[accountId],
                        enabled,
                    },
                },
            },
        },
    };
}
export const feishuSetupAdapter = {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId }) => {
        const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;
        if (isDefault) {
            return {
                ...cfg,
                channels: {
                    ...cfg.channels,
                    feishu: {
                        ...cfg.channels?.feishu,
                        enabled: true,
                    },
                },
            };
        }
        return setFeishuNamedAccountEnabled(cfg, accountId, true);
    },
};
