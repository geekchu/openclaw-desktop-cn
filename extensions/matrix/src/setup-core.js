import { DEFAULT_ACCOUNT_ID, normalizeAccountId, prepareScopedSetupConfig, } from "openclaw/plugin-sdk/setup";
import { updateMatrixAccountConfig } from "./matrix/config-update.js";
import { applyMatrixSetupAccountConfig, validateMatrixSetupInput } from "./setup-config.js";
const channel = "matrix";
function resolveMatrixSetupAccountId(params) {
    return normalizeAccountId(params.accountId?.trim() || params.name?.trim() || DEFAULT_ACCOUNT_ID);
}
export function buildMatrixConfigUpdate(cfg, input) {
    return updateMatrixAccountConfig(cfg, DEFAULT_ACCOUNT_ID, {
        enabled: true,
        homeserver: input.homeserver,
        allowPrivateNetwork: input.allowPrivateNetwork,
        userId: input.userId,
        accessToken: input.accessToken,
        password: input.password,
        deviceName: input.deviceName,
        initialSyncLimit: input.initialSyncLimit,
    });
}
export const matrixSetupAdapter = {
    resolveAccountId: ({ accountId, input }) => resolveMatrixSetupAccountId({
        accountId,
        name: input?.name,
    }),
    resolveBindingAccountId: ({ accountId, agentId }) => resolveMatrixSetupAccountId({
        accountId,
        name: agentId,
    }),
    applyAccountName: ({ cfg, accountId, name }) => prepareScopedSetupConfig({
        cfg: cfg,
        channelKey: channel,
        accountId,
        name,
    }),
    validateInput: ({ accountId, input }) => validateMatrixSetupInput({ accountId, input }),
    applyAccountConfig: ({ cfg, accountId, input }) => applyMatrixSetupAccountConfig({
        cfg: cfg,
        accountId,
        input,
    }),
    afterAccountConfigWritten: async ({ previousCfg, cfg, accountId, runtime }) => {
        const { runMatrixSetupBootstrapAfterConfigWrite } = await import("./setup-bootstrap.js");
        await runMatrixSetupBootstrapAfterConfigWrite({
            previousCfg: previousCfg,
            cfg: cfg,
            accountId,
            runtime,
        });
    },
};
