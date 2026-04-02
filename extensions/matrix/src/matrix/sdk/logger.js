import { format } from "node:util";
import { redactSensitiveText } from "openclaw/plugin-sdk/diagnostics-otel";
import { getMatrixRuntime } from "../../runtime.js";
export function noop() {
    // no-op
}
let forceConsoleLogging = false;
export function setMatrixConsoleLogging(enabled) {
    forceConsoleLogging = enabled;
}
function resolveRuntimeLogger(module) {
    if (forceConsoleLogging) {
        return null;
    }
    try {
        return getMatrixRuntime().logging.getChildLogger({ module: `matrix:${module}` });
    }
    catch {
        return null;
    }
}
function formatMessage(module, messageOrObject) {
    if (messageOrObject.length === 0) {
        return `[${module}]`;
    }
    return redactSensitiveText(`[${module}] ${format(...messageOrObject)}`);
}
export class ConsoleLogger {
    emit(level, module, ...messageOrObject) {
        const runtimeLogger = resolveRuntimeLogger(module);
        const message = formatMessage(module, messageOrObject);
        if (runtimeLogger) {
            if (level === "debug") {
                runtimeLogger.debug?.(message);
                return;
            }
            runtimeLogger[level](message);
            return;
        }
        if (level === "debug") {
            console.debug(message);
            return;
        }
        console[level](message);
    }
    trace(module, ...messageOrObject) {
        this.emit("debug", module, ...messageOrObject);
    }
    debug(module, ...messageOrObject) {
        this.emit("debug", module, ...messageOrObject);
    }
    info(module, ...messageOrObject) {
        this.emit("info", module, ...messageOrObject);
    }
    warn(module, ...messageOrObject) {
        this.emit("warn", module, ...messageOrObject);
    }
    error(module, ...messageOrObject) {
        this.emit("error", module, ...messageOrObject);
    }
}
const defaultLogger = new ConsoleLogger();
let activeLogger = defaultLogger;
export const LogService = {
    setLogger(logger) {
        activeLogger = logger;
    },
    trace(module, ...messageOrObject) {
        activeLogger.trace(module, ...messageOrObject);
    },
    debug(module, ...messageOrObject) {
        activeLogger.debug(module, ...messageOrObject);
    },
    info(module, ...messageOrObject) {
        activeLogger.info(module, ...messageOrObject);
    },
    warn(module, ...messageOrObject) {
        activeLogger.warn(module, ...messageOrObject);
    },
    error(module, ...messageOrObject) {
        activeLogger.error(module, ...messageOrObject);
    },
};
