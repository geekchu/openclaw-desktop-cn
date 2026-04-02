import { Chalk } from "chalk";
import { isVerbose } from "../global-state.js";
import { defaultRuntime } from "../runtime.js";
import { clearActiveProgressLine } from "../terminal/progress-line.js";
import { formatConsoleTimestamp, getConsoleSettings, shouldLogSubsystemToConsole, } from "./console.js";
import { levelToMinLevel } from "./levels.js";
import { getChildLogger, isFileLogLevelEnabled } from "./logger.js";
import { loggingState } from "./state.js";
function shouldLogToConsole(level, settings) {
    if (settings.level === "silent") {
        return false;
    }
    const current = levelToMinLevel(level);
    const min = levelToMinLevel(settings.level);
    return current <= min;
}
const inspectValue = (() => {
    const getBuiltinModule = process.getBuiltinModule;
    if (typeof getBuiltinModule !== "function") {
        return null;
    }
    try {
        const utilNamespace = getBuiltinModule("util");
        return typeof utilNamespace.inspect === "function" ? utilNamespace.inspect : null;
    }
    catch {
        return null;
    }
})();
function formatRuntimeArg(arg) {
    if (typeof arg === "string") {
        return arg;
    }
    if (inspectValue) {
        return inspectValue(arg);
    }
    try {
        return JSON.stringify(arg);
    }
    catch {
        return String(arg);
    }
}
function isRichConsoleEnv() {
    const term = (process.env.TERM ?? "").toLowerCase();
    if (process.env.COLORTERM || process.env.TERM_PROGRAM) {
        return true;
    }
    return term.length > 0 && term !== "dumb";
}
function getColorForConsole() {
    const hasForceColor = typeof process.env.FORCE_COLOR === "string" &&
        process.env.FORCE_COLOR.trim().length > 0 &&
        process.env.FORCE_COLOR.trim() !== "0";
    if (process.env.NO_COLOR && !hasForceColor) {
        return new Chalk({ level: 0 });
    }
    const hasTty = Boolean(process.stdout.isTTY || process.stderr.isTTY);
    return hasTty || isRichConsoleEnv() ? new Chalk({ level: 1 }) : new Chalk({ level: 0 });
}
const SUBSYSTEM_COLORS = ["cyan", "green", "yellow", "blue", "magenta", "red"];
const SUBSYSTEM_COLOR_OVERRIDES = {
    "gmail-watcher": "blue",
};
const SUBSYSTEM_PREFIXES_TO_DROP = ["gateway", "channels", "providers"];
const SUBSYSTEM_MAX_SEGMENTS = 2;
// Keep local to avoid importing channel registry into hot logging paths.
const CHANNEL_SUBSYSTEM_PREFIXES = new Set([
    "telegram",
    "whatsapp",
    "discord",
    "irc",
    "googlechat",
    "slack",
    "signal",
    "imessage",
]);
function pickSubsystemColor(color, subsystem) {
    const override = SUBSYSTEM_COLOR_OVERRIDES[subsystem];
    if (override) {
        return color[override];
    }
    let hash = 0;
    for (let i = 0; i < subsystem.length; i += 1) {
        hash = (hash * 31 + subsystem.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % SUBSYSTEM_COLORS.length;
    const name = SUBSYSTEM_COLORS[idx];
    return color[name];
}
function formatSubsystemForConsole(subsystem) {
    const parts = subsystem.split("/").filter(Boolean);
    const original = parts.join("/") || subsystem;
    while (parts.length > 0 &&
        SUBSYSTEM_PREFIXES_TO_DROP.includes(parts[0])) {
        parts.shift();
    }
    if (parts.length === 0) {
        return original;
    }
    if (CHANNEL_SUBSYSTEM_PREFIXES.has(parts[0])) {
        return parts[0];
    }
    if (parts.length > SUBSYSTEM_MAX_SEGMENTS) {
        return parts.slice(-SUBSYSTEM_MAX_SEGMENTS).join("/");
    }
    return parts.join("/");
}
export function stripRedundantSubsystemPrefixForConsole(message, displaySubsystem) {
    if (!displaySubsystem) {
        return message;
    }
    // Common duplication: "[discord] discord: ..." (when a message manually includes the subsystem tag).
    if (message.startsWith("[")) {
        const closeIdx = message.indexOf("]");
        if (closeIdx > 1) {
            const bracketTag = message.slice(1, closeIdx);
            if (bracketTag.toLowerCase() === displaySubsystem.toLowerCase()) {
                let i = closeIdx + 1;
                while (message[i] === " ") {
                    i += 1;
                }
                return message.slice(i);
            }
        }
    }
    const prefix = message.slice(0, displaySubsystem.length);
    if (prefix.toLowerCase() !== displaySubsystem.toLowerCase()) {
        return message;
    }
    const next = message.slice(displaySubsystem.length, displaySubsystem.length + 1);
    if (next !== ":" && next !== " ") {
        return message;
    }
    let i = displaySubsystem.length;
    while (message[i] === " ") {
        i += 1;
    }
    if (message[i] === ":") {
        i += 1;
    }
    while (message[i] === " ") {
        i += 1;
    }
    return message.slice(i);
}
function formatConsoleLine(opts) {
    const displaySubsystem = opts.style === "json" ? opts.subsystem : formatSubsystemForConsole(opts.subsystem);
    if (opts.style === "json") {
        return JSON.stringify({
            time: formatConsoleTimestamp("json"),
            level: opts.level,
            subsystem: displaySubsystem,
            message: opts.message,
            ...opts.meta,
        });
    }
    const color = getColorForConsole();
    const prefix = `[${displaySubsystem}]`;
    const prefixColor = pickSubsystemColor(color, displaySubsystem);
    const levelColor = opts.level === "error" || opts.level === "fatal"
        ? color.red
        : opts.level === "warn"
            ? color.yellow
            : opts.level === "debug" || opts.level === "trace"
                ? color.gray
                : color.cyan;
    const displayMessage = stripRedundantSubsystemPrefixForConsole(opts.message, displaySubsystem);
    const time = (() => {
        if (opts.style === "pretty") {
            return color.gray(formatConsoleTimestamp("pretty"));
        }
        if (loggingState.consoleTimestampPrefix) {
            return color.gray(formatConsoleTimestamp(opts.style));
        }
        return "";
    })();
    const prefixToken = prefixColor(prefix);
    const head = [time, prefixToken].filter(Boolean).join(" ");
    return `${head} ${levelColor(displayMessage)}`;
}
function writeConsoleLine(level, line) {
    clearActiveProgressLine();
    const sanitized = process.platform === "win32" && process.env.GITHUB_ACTIONS === "true"
        ? line.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "?").replace(/[\uD800-\uDFFF]/g, "?")
        : line;
    const sink = loggingState.rawConsole ?? console;
    if (loggingState.forceConsoleToStderr || level === "error" || level === "fatal") {
        (sink.error ?? console.error)(sanitized);
    }
    else if (level === "warn") {
        (sink.warn ?? console.warn)(sanitized);
    }
    else {
        (sink.log ?? console.log)(sanitized);
    }
}
function shouldSuppressProbeConsoleLine(params) {
    if (isVerbose()) {
        return false;
    }
    if (params.level === "error" || params.level === "fatal") {
        return false;
    }
    const isProbeSuppressedSubsystem = params.subsystem === "agent/embedded" ||
        params.subsystem.startsWith("agent/embedded/") ||
        params.subsystem === "model-fallback" ||
        params.subsystem.startsWith("model-fallback/");
    if (!isProbeSuppressedSubsystem) {
        return false;
    }
    const runLikeId = typeof params.meta?.runId === "string"
        ? params.meta.runId
        : typeof params.meta?.sessionId === "string"
            ? params.meta.sessionId
            : undefined;
    if (runLikeId?.startsWith("probe-")) {
        return true;
    }
    return /(sessionId|runId)=probe-/.test(params.message);
}
function logToFile(fileLogger, level, message, meta) {
    if (level === "silent") {
        return;
    }
    const safeLevel = level;
    const method = fileLogger[safeLevel];
    if (typeof method !== "function") {
        return;
    }
    if (meta && Object.keys(meta).length > 0) {
        method.call(fileLogger, meta, message);
    }
    else {
        method.call(fileLogger, message);
    }
}
export function createSubsystemLogger(subsystem) {
    let fileLogger = null;
    const logger = {
        subsystem,
        isEnabled(level, target = "any") {
            const isConsoleEnabled = shouldLogToConsole(level, { level: getConsoleSettings().level }) &&
                shouldLogSubsystemToConsole(subsystem);
            const isFileEnabled = isFileLogLevelEnabled(level);
            if (target === "console") {
                return isConsoleEnabled;
            }
            if (target === "file") {
                return isFileEnabled;
            }
            return isConsoleEnabled || isFileEnabled;
        },
        trace(message, meta) {
            const level = "trace";
            const consoleSettings = getConsoleSettings();
            const consoleEnabled = shouldLogToConsole(level, { level: consoleSettings.level }) &&
                shouldLogSubsystemToConsole(subsystem);
            const fileEnabled = isFileLogLevelEnabled(level);
            if (!consoleEnabled && !fileEnabled) {
                return;
            }
            let consoleMessageOverride;
            let fileMeta = meta;
            if (meta && Object.keys(meta).length > 0) {
                const { consoleMessage, ...rest } = meta;
                if (typeof consoleMessage === "string") {
                    consoleMessageOverride = consoleMessage;
                }
                fileMeta = Object.keys(rest).length > 0 ? rest : undefined;
            }
            if (fileEnabled) {
                if (!fileLogger) {
                    fileLogger = getChildLogger({ subsystem });
                }
                logToFile(fileLogger, level, message, fileMeta);
            }
            if (!consoleEnabled) {
                return;
            }
            const consoleMessage = consoleMessageOverride ?? message;
            if (shouldSuppressProbeConsoleLine({
                level,
                subsystem,
                message: consoleMessage,
                meta: fileMeta,
            })) {
                return;
            }
            writeConsoleLine(level, formatConsoleLine({
                level,
                subsystem,
                message: consoleSettings.style === "json" ? message : consoleMessage,
                style: consoleSettings.style,
                meta: fileMeta,
            }));
        },
        debug(message, meta) {
            const level = "debug";
            const consoleSettings = getConsoleSettings();
            const consoleEnabled = shouldLogToConsole(level, { level: consoleSettings.level }) &&
                shouldLogSubsystemToConsole(subsystem);
            const fileEnabled = isFileLogLevelEnabled(level);
            if (!consoleEnabled && !fileEnabled) {
                return;
            }
            let consoleMessageOverride;
            let fileMeta = meta;
            if (meta && Object.keys(meta).length > 0) {
                const { consoleMessage, ...rest } = meta;
                if (typeof consoleMessage === "string") {
                    consoleMessageOverride = consoleMessage;
                }
                fileMeta = Object.keys(rest).length > 0 ? rest : undefined;
            }
            if (fileEnabled) {
                if (!fileLogger) {
                    fileLogger = getChildLogger({ subsystem });
                }
                logToFile(fileLogger, level, message, fileMeta);
            }
            if (!consoleEnabled) {
                return;
            }
            const consoleMessage = consoleMessageOverride ?? message;
            if (shouldSuppressProbeConsoleLine({
                level,
                subsystem,
                message: consoleMessage,
                meta: fileMeta,
            })) {
                return;
            }
            writeConsoleLine(level, formatConsoleLine({
                level,
                subsystem,
                message: consoleSettings.style === "json" ? message : consoleMessage,
                style: consoleSettings.style,
                meta: fileMeta,
            }));
        },
        info(message, meta) {
            const level = "info";
            const consoleSettings = getConsoleSettings();
            const consoleEnabled = shouldLogToConsole(level, { level: consoleSettings.level }) &&
                shouldLogSubsystemToConsole(subsystem);
            const fileEnabled = isFileLogLevelEnabled(level);
            if (!consoleEnabled && !fileEnabled) {
                return;
            }
            let consoleMessageOverride;
            let fileMeta = meta;
            if (meta && Object.keys(meta).length > 0) {
                const { consoleMessage, ...rest } = meta;
                if (typeof consoleMessage === "string") {
                    consoleMessageOverride = consoleMessage;
                }
                fileMeta = Object.keys(rest).length > 0 ? rest : undefined;
            }
            if (fileEnabled) {
                if (!fileLogger) {
                    fileLogger = getChildLogger({ subsystem });
                }
                logToFile(fileLogger, level, message, fileMeta);
            }
            if (!consoleEnabled) {
                return;
            }
            const consoleMessage = consoleMessageOverride ?? message;
            if (shouldSuppressProbeConsoleLine({
                level,
                subsystem,
                message: consoleMessage,
                meta: fileMeta,
            })) {
                return;
            }
            writeConsoleLine(level, formatConsoleLine({
                level,
                subsystem,
                message: consoleSettings.style === "json" ? message : consoleMessage,
                style: consoleSettings.style,
                meta: fileMeta,
            }));
        },
        warn(message, meta) {
            const level = "warn";
            const consoleSettings = getConsoleSettings();
            const consoleEnabled = shouldLogToConsole(level, { level: consoleSettings.level }) &&
                shouldLogSubsystemToConsole(subsystem);
            const fileEnabled = isFileLogLevelEnabled(level);
            if (!consoleEnabled && !fileEnabled) {
                return;
            }
            let consoleMessageOverride;
            let fileMeta = meta;
            if (meta && Object.keys(meta).length > 0) {
                const { consoleMessage, ...rest } = meta;
                if (typeof consoleMessage === "string") {
                    consoleMessageOverride = consoleMessage;
                }
                fileMeta = Object.keys(rest).length > 0 ? rest : undefined;
            }
            if (fileEnabled) {
                if (!fileLogger) {
                    fileLogger = getChildLogger({ subsystem });
                }
                logToFile(fileLogger, level, message, fileMeta);
            }
            if (!consoleEnabled) {
                return;
            }
            const consoleMessage = consoleMessageOverride ?? message;
            if (shouldSuppressProbeConsoleLine({
                level,
                subsystem,
                message: consoleMessage,
                meta: fileMeta,
            })) {
                return;
            }
            writeConsoleLine(level, formatConsoleLine({
                level,
                subsystem,
                message: consoleSettings.style === "json" ? message : consoleMessage,
                style: consoleSettings.style,
                meta: fileMeta,
            }));
        },
        error(message, meta) {
            const level = "error";
            const consoleSettings = getConsoleSettings();
            const consoleEnabled = shouldLogToConsole(level, { level: consoleSettings.level }) &&
                shouldLogSubsystemToConsole(subsystem);
            const fileEnabled = isFileLogLevelEnabled(level);
            if (!consoleEnabled && !fileEnabled) {
                return;
            }
            let consoleMessageOverride;
            let fileMeta = meta;
            if (meta && Object.keys(meta).length > 0) {
                const { consoleMessage, ...rest } = meta;
                if (typeof consoleMessage === "string") {
                    consoleMessageOverride = consoleMessage;
                }
                fileMeta = Object.keys(rest).length > 0 ? rest : undefined;
            }
            if (fileEnabled) {
                if (!fileLogger) {
                    fileLogger = getChildLogger({ subsystem });
                }
                logToFile(fileLogger, level, message, fileMeta);
            }
            if (!consoleEnabled) {
                return;
            }
            const consoleMessage = consoleMessageOverride ?? message;
            if (shouldSuppressProbeConsoleLine({
                level,
                subsystem,
                message: consoleMessage,
                meta: fileMeta,
            })) {
                return;
            }
            writeConsoleLine(level, formatConsoleLine({
                level,
                subsystem,
                message: consoleSettings.style === "json" ? message : consoleMessage,
                style: consoleSettings.style,
                meta: fileMeta,
            }));
        },
        fatal(message, meta) {
            const level = "fatal";
            const consoleSettings = getConsoleSettings();
            const consoleEnabled = shouldLogToConsole(level, { level: consoleSettings.level }) &&
                shouldLogSubsystemToConsole(subsystem);
            const fileEnabled = isFileLogLevelEnabled(level);
            if (!consoleEnabled && !fileEnabled) {
                return;
            }
            let consoleMessageOverride;
            let fileMeta = meta;
            if (meta && Object.keys(meta).length > 0) {
                const { consoleMessage, ...rest } = meta;
                if (typeof consoleMessage === "string") {
                    consoleMessageOverride = consoleMessage;
                }
                fileMeta = Object.keys(rest).length > 0 ? rest : undefined;
            }
            if (fileEnabled) {
                if (!fileLogger) {
                    fileLogger = getChildLogger({ subsystem });
                }
                logToFile(fileLogger, level, message, fileMeta);
            }
            if (!consoleEnabled) {
                return;
            }
            const consoleMessage = consoleMessageOverride ?? message;
            if (shouldSuppressProbeConsoleLine({
                level,
                subsystem,
                message: consoleMessage,
                meta: fileMeta,
            })) {
                return;
            }
            writeConsoleLine(level, formatConsoleLine({
                level,
                subsystem,
                message: consoleSettings.style === "json" ? message : consoleMessage,
                style: consoleSettings.style,
                meta: fileMeta,
            }));
        },
        raw(message) {
            if (isFileLogLevelEnabled("info")) {
                if (!fileLogger) {
                    fileLogger = getChildLogger({ subsystem });
                }
                logToFile(fileLogger, "info", message, { raw: true });
            }
            if (shouldLogToConsole("info", { level: getConsoleSettings().level }) &&
                shouldLogSubsystemToConsole(subsystem)) {
                if (shouldSuppressProbeConsoleLine({ level: "info", subsystem, message })) {
                    return;
                }
                writeConsoleLine("info", message);
            }
        },
        child(name) {
            return createSubsystemLogger(`${subsystem}/${name}`);
        },
    };
    return logger;
}
export function runtimeForLogger(logger, exit = defaultRuntime.exit) {
    return {
        log(...args) {
            logger.info(args
                .map((arg) => formatRuntimeArg(arg))
                .join(" ")
                .trim());
        },
        error(...args) {
            logger.error(args
                .map((arg) => formatRuntimeArg(arg))
                .join(" ")
                .trim());
        },
        writeStdout(value) {
            logger.info(value);
        },
        writeJson(value, space = 2) {
            logger.info(JSON.stringify(value, null, space > 0 ? space : undefined));
        },
        exit,
    };
}
export function createSubsystemRuntime(subsystem, exit = defaultRuntime.exit) {
    return runtimeForLogger(createSubsystemLogger(subsystem), exit);
}
