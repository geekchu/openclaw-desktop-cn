import { format } from "node:util";
export { createNonExitingRuntime, defaultRuntime } from "../runtime.js";
export { danger, info, isVerbose, isYes, logVerbose, logVerboseConsole, setVerbose, setYes, shouldLogVerbose, success, warn, } from "../globals.js";
export * from "../logging.js";
export { waitForAbortSignal } from "../infra/abort-signal.js";
export { registerUnhandledRejectionHandler } from "../infra/unhandled-rejections.js";
/** Adapt a simple logger into the RuntimeEnv contract used by shared plugin SDK helpers. */
export function createLoggerBackedRuntime(params) {
    return {
        log: (...args) => {
            params.logger.info(format(...args));
        },
        error: (...args) => {
            params.logger.error(format(...args));
        },
        writeStdout: (value) => {
            params.logger.info(value);
        },
        writeJson: (value, space = 2) => {
            params.logger.info(JSON.stringify(value, null, space > 0 ? space : undefined));
        },
        exit: (code) => {
            throw params.exitError?.(code) ?? new Error(`exit ${code}`);
        },
    };
}
export function resolveRuntimeEnv(params) {
    return params.runtime ?? createLoggerBackedRuntime(params);
}
export function resolveRuntimeEnvWithUnavailableExit(params) {
    if (params.runtime) {
        return resolveRuntimeEnv({
            runtime: params.runtime,
            logger: params.logger,
            exitError: () => new Error(params.unavailableMessage ?? "Runtime exit not available"),
        });
    }
    return resolveRuntimeEnv({
        logger: params.logger,
        exitError: () => new Error(params.unavailableMessage ?? "Runtime exit not available"),
    });
}
