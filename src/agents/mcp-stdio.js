function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function toStringRecord(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const entries = Object.entries(value)
        .map(([key, entry]) => {
        if (typeof entry === "string") {
            return [key, entry];
        }
        if (typeof entry === "number" || typeof entry === "boolean") {
            return [key, String(entry)];
        }
        return null;
    })
        .filter((entry) => entry !== null);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
function toStringArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const entries = value.filter((entry) => typeof entry === "string");
    return entries.length > 0 ? entries : [];
}
export function resolveStdioMcpServerLaunchConfig(raw) {
    if (!isRecord(raw)) {
        return { ok: false, reason: "server config must be an object" };
    }
    if (typeof raw.command !== "string" || raw.command.trim().length === 0) {
        if (typeof raw.url === "string" && raw.url.trim().length > 0) {
            return {
                ok: false,
                reason: "only stdio MCP servers are supported right now",
            };
        }
        return { ok: false, reason: "its command is missing" };
    }
    const cwd = typeof raw.cwd === "string" && raw.cwd.trim().length > 0
        ? raw.cwd
        : typeof raw.workingDirectory === "string" && raw.workingDirectory.trim().length > 0
            ? raw.workingDirectory
            : undefined;
    return {
        ok: true,
        config: {
            command: raw.command,
            args: toStringArray(raw.args),
            env: toStringRecord(raw.env),
            cwd,
        },
    };
}
export function describeStdioMcpServerLaunchConfig(config) {
    const args = Array.isArray(config.args) && config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
    const cwd = config.cwd ? ` (cwd=${config.cwd})` : "";
    return `${config.command}${args}${cwd}`;
}
