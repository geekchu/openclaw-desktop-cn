import { shouldLogVerbose } from "../../globals.js";
import { getChildLogger } from "../../logging.js";
import { normalizeLogLevel } from "../../logging/levels.js";
export function createRuntimeLogging() {
    return {
        shouldLogVerbose,
        getChildLogger: (bindings, opts) => {
            const logger = getChildLogger(bindings, {
                level: opts?.level ? normalizeLogLevel(opts.level) : undefined,
            });
            return {
                debug: (message) => logger.debug?.(message),
                info: (message) => logger.info(message),
                warn: (message) => logger.warn(message),
                error: (message) => logger.error(message),
            };
        },
    };
}
