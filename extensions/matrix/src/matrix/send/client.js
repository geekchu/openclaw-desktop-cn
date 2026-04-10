import { getMatrixRuntime } from "../../runtime.js";
import { resolveMatrixAccountConfig } from "../account-config.js";
const getCore = () => getMatrixRuntime();
let matrixSendClientRuntimePromise = null;
async function loadMatrixSendClientRuntime() {
    matrixSendClientRuntimePromise ??= import("../client-bootstrap.js");
    return await matrixSendClientRuntimePromise;
}
export function resolveMediaMaxBytes(accountId, cfg) {
    const resolvedCfg = cfg ?? getCore().config.loadConfig();
    const matrixCfg = resolveMatrixAccountConfig({ cfg: resolvedCfg, accountId });
    const mediaMaxMb = typeof matrixCfg.mediaMaxMb === "number" ? matrixCfg.mediaMaxMb : undefined;
    if (typeof mediaMaxMb === "number") {
        return mediaMaxMb * 1024 * 1024;
    }
    return undefined;
}
export async function withResolvedMatrixSendClient(opts, run) {
    return await withResolvedMatrixClient({
        ...opts,
        // One-off outbound sends still need a started client so room encryption
        // state and live crypto sessions are available before sendMessage/sendEvent.
        readiness: "started",
    }, run, 
    // Started one-off send clients should flush sync/crypto state before CLI
    // shutdown paths can tear down the process.
    "persist");
}
export async function withResolvedMatrixControlClient(opts, run) {
    return await withResolvedMatrixClient({
        ...opts,
        readiness: "none",
    }, run);
}
async function withResolvedMatrixClient(opts, run, shutdownBehavior) {
    if (opts.client) {
        return await run(opts.client);
    }
    const { withResolvedRuntimeMatrixClient } = await loadMatrixSendClientRuntime();
    return await withResolvedRuntimeMatrixClient(opts, run, shutdownBehavior);
}
