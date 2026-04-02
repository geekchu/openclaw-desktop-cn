import { getMatrixRuntime } from "../../runtime.js";
import { resolveMatrixAccountConfig } from "../accounts.js";
import { withResolvedRuntimeMatrixClient } from "../client-bootstrap.js";
const getCore = () => getMatrixRuntime();
export function resolveMediaMaxBytes(accountId, cfg) {
    const resolvedCfg = cfg ?? getCore().config.loadConfig();
    const matrixCfg = resolveMatrixAccountConfig({ cfg: resolvedCfg, accountId });
    const mediaMaxMb = typeof matrixCfg.mediaMaxMb === "number" ? matrixCfg.mediaMaxMb : undefined;
    if (typeof mediaMaxMb === "number") {
        return mediaMaxMb * 1024 * 1024;
    }
    return undefined;
}
export async function withResolvedMatrixClient(opts, run) {
    return await withResolvedRuntimeMatrixClient({
        ...opts,
        readiness: "prepared",
    }, run);
}
