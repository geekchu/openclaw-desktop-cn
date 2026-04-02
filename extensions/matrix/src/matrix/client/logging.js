import { logger as matrixJsSdkRootLogger } from "matrix-js-sdk/lib/logger.js";
import { ConsoleLogger, LogService, setMatrixConsoleLogging } from "../sdk/logger.js";
let matrixSdkLoggingConfigured = false;
let matrixSdkLogMode = "default";
const matrixSdkBaseLogger = new ConsoleLogger();
const matrixSdkSilentMethodFactory = () => () => { };
let matrixSdkRootMethodFactory;
let matrixSdkRootLoggerInitialized = false;
function shouldSuppressMatrixHttpNotFound(module, messageOrObject) {
    if (!module.includes("MatrixHttpClient")) {
        return false;
    }
    return messageOrObject.some((entry) => {
        if (!entry || typeof entry !== "object") {
            return false;
        }
        return entry.errcode === "M_NOT_FOUND";
    });
}
export function ensureMatrixSdkLoggingConfigured() {
    if (!matrixSdkLoggingConfigured) {
        matrixSdkLoggingConfigured = true;
    }
    applyMatrixSdkLogger();
}
export function setMatrixSdkLogMode(mode) {
    matrixSdkLogMode = mode;
    if (!matrixSdkLoggingConfigured) {
        return;
    }
    applyMatrixSdkLogger();
}
export function setMatrixSdkConsoleLogging(enabled) {
    setMatrixConsoleLogging(enabled);
}
export function createMatrixJsSdkClientLogger(prefix = "matrix") {
    return createMatrixJsSdkLoggerInstance(prefix);
}
function applyMatrixJsSdkRootLoggerMode() {
    const rootLogger = matrixJsSdkRootLogger;
    if (!matrixSdkRootLoggerInitialized) {
        matrixSdkRootMethodFactory = rootLogger.methodFactory;
        matrixSdkRootLoggerInitialized = true;
    }
    rootLogger.methodFactory =
        matrixSdkLogMode === "quiet" ? matrixSdkSilentMethodFactory : matrixSdkRootMethodFactory;
    rootLogger.rebuild?.();
}
function applyMatrixSdkLogger() {
    applyMatrixJsSdkRootLoggerMode();
    if (matrixSdkLogMode === "quiet") {
        LogService.setLogger({
            trace: () => { },
            debug: () => { },
            info: () => { },
            warn: () => { },
            error: () => { },
        });
        return;
    }
    LogService.setLogger({
        trace: (module, ...messageOrObject) => matrixSdkBaseLogger.trace(module, ...messageOrObject),
        debug: (module, ...messageOrObject) => matrixSdkBaseLogger.debug(module, ...messageOrObject),
        info: (module, ...messageOrObject) => matrixSdkBaseLogger.info(module, ...messageOrObject),
        warn: (module, ...messageOrObject) => matrixSdkBaseLogger.warn(module, ...messageOrObject),
        error: (module, ...messageOrObject) => {
            if (shouldSuppressMatrixHttpNotFound(module, messageOrObject)) {
                return;
            }
            matrixSdkBaseLogger.error(module, ...messageOrObject);
        },
    });
}
function createMatrixJsSdkLoggerInstance(prefix) {
    const log = (method, ...messageOrObject) => {
        if (matrixSdkLogMode === "quiet") {
            return;
        }
        matrixSdkBaseLogger[method](prefix, ...messageOrObject);
    };
    return {
        trace: (...messageOrObject) => log("trace", ...messageOrObject),
        debug: (...messageOrObject) => log("debug", ...messageOrObject),
        info: (...messageOrObject) => log("info", ...messageOrObject),
        warn: (...messageOrObject) => log("warn", ...messageOrObject),
        error: (...messageOrObject) => {
            if (shouldSuppressMatrixHttpNotFound(prefix, messageOrObject)) {
                return;
            }
            log("error", ...messageOrObject);
        },
        getChild: (namespace) => {
            const nextNamespace = namespace.trim();
            return createMatrixJsSdkLoggerInstance(nextNamespace ? `${prefix}.${nextNamespace}` : prefix);
        },
    };
}
