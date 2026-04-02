import fsPromises from "node:fs/promises";
import { createBrowserControlContext, createBrowserRouteDispatcher, detectMime, isPersistentBrowserProfileMutation, loadConfig, normalizeBrowserRequestPath, redactCdpUrl, resolveBrowserConfig, resolveRequestedBrowserProfile, startBrowserControlServiceFromConfig, withTimeout, } from "../core-api.js";
const BROWSER_PROXY_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_BROWSER_PROXY_TIMEOUT_MS = 20_000;
const BROWSER_PROXY_STATUS_TIMEOUT_MS = 750;
function normalizeProfileAllowlist(raw) {
    return Array.isArray(raw) ? raw.map((entry) => entry.trim()).filter(Boolean) : [];
}
function resolveBrowserProxyConfig() {
    const cfg = loadConfig();
    const proxy = cfg.nodeHost?.browserProxy;
    const allowProfiles = normalizeProfileAllowlist(proxy?.allowProfiles);
    const enabled = proxy?.enabled !== false;
    return { enabled, allowProfiles };
}
let browserControlReady = null;
async function ensureBrowserControlService() {
    if (browserControlReady) {
        return browserControlReady;
    }
    browserControlReady = (async () => {
        const cfg = loadConfig();
        const resolved = resolveBrowserConfig(cfg.browser, cfg);
        if (!resolved.enabled) {
            throw new Error("browser control disabled");
        }
        const started = await startBrowserControlServiceFromConfig();
        if (!started) {
            throw new Error("browser control disabled");
        }
    })();
    return browserControlReady;
}
function isProfileAllowed(params) {
    const { allowProfiles, profile } = params;
    if (!allowProfiles.length) {
        return true;
    }
    if (!profile) {
        return false;
    }
    return allowProfiles.includes(profile.trim());
}
function collectBrowserProxyPaths(payload) {
    const paths = new Set();
    const obj = typeof payload === "object" && payload !== null ? payload : null;
    if (!obj) {
        return [];
    }
    if (typeof obj.path === "string" && obj.path.trim()) {
        paths.add(obj.path.trim());
    }
    if (typeof obj.imagePath === "string" && obj.imagePath.trim()) {
        paths.add(obj.imagePath.trim());
    }
    const download = obj.download;
    if (download && typeof download === "object") {
        const dlPath = download.path;
        if (typeof dlPath === "string" && dlPath.trim()) {
            paths.add(dlPath.trim());
        }
    }
    return [...paths];
}
async function readBrowserProxyFile(filePath) {
    const stat = await fsPromises.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
        return null;
    }
    if (stat.size > BROWSER_PROXY_MAX_FILE_BYTES) {
        throw new Error(`browser proxy file exceeds ${Math.round(BROWSER_PROXY_MAX_FILE_BYTES / (1024 * 1024))}MB`);
    }
    const buffer = await fsPromises.readFile(filePath);
    const mimeType = await detectMime({ buffer, filePath });
    return { path: filePath, base64: buffer.toString("base64"), mimeType };
}
function decodeParams(raw) {
    if (!raw) {
        throw new Error("INVALID_REQUEST: paramsJSON required");
    }
    return JSON.parse(raw);
}
function resolveBrowserProxyTimeout(timeoutMs) {
    return typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
        ? Math.max(1, Math.floor(timeoutMs))
        : DEFAULT_BROWSER_PROXY_TIMEOUT_MS;
}
function isBrowserProxyTimeoutError(err) {
    return String(err).includes("browser proxy request timed out");
}
function isWsBackedBrowserProxyPath(path) {
    return (path === "/act" ||
        path === "/navigate" ||
        path === "/pdf" ||
        path === "/screenshot" ||
        path === "/snapshot");
}
async function readBrowserProxyStatus(params) {
    const query = params.profile ? { profile: params.profile } : {};
    try {
        const response = await withTimeout((signal) => params.dispatcher.dispatch({
            method: "GET",
            path: "/",
            query,
            signal,
        }), BROWSER_PROXY_STATUS_TIMEOUT_MS, "browser proxy status");
        if (response.status >= 400 || !response.body || typeof response.body !== "object") {
            return null;
        }
        const body = response.body;
        return {
            running: body.running,
            transport: body.transport,
            cdpHttp: body.cdpHttp,
            cdpReady: body.cdpReady,
            cdpUrl: body.cdpUrl,
        };
    }
    catch {
        return null;
    }
}
function formatBrowserProxyTimeoutMessage(params) {
    const parts = [
        `browser proxy timed out for ${params.method} ${params.path} after ${params.timeoutMs}ms`,
        params.wsBacked ? "ws-backed browser action" : "browser action",
    ];
    if (params.profile) {
        parts.push(`profile=${params.profile}`);
    }
    if (params.status) {
        const statusParts = [
            `running=${String(params.status.running)}`,
            `cdpHttp=${String(params.status.cdpHttp)}`,
            `cdpReady=${String(params.status.cdpReady)}`,
        ];
        if (typeof params.status.transport === "string" && params.status.transport.trim()) {
            statusParts.push(`transport=${params.status.transport}`);
        }
        if (typeof params.status.cdpUrl === "string" && params.status.cdpUrl.trim()) {
            statusParts.push(`cdpUrl=${redactCdpUrl(params.status.cdpUrl)}`);
        }
        parts.push(`status(${statusParts.join(", ")})`);
    }
    return parts.join("; ");
}
export async function runBrowserProxyCommand(paramsJSON) {
    const params = decodeParams(paramsJSON);
    const pathValue = typeof params.path === "string" ? params.path.trim() : "";
    if (!pathValue) {
        throw new Error("INVALID_REQUEST: path required");
    }
    const proxyConfig = resolveBrowserProxyConfig();
    if (!proxyConfig.enabled) {
        throw new Error("UNAVAILABLE: node browser proxy disabled");
    }
    await ensureBrowserControlService();
    const cfg = loadConfig();
    const resolved = resolveBrowserConfig(cfg.browser, cfg);
    const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
    const path = normalizeBrowserRequestPath(pathValue);
    const body = params.body;
    const requestedProfile = resolveRequestedBrowserProfile({
        query: params.query,
        body,
        profile: params.profile,
    }) ?? "";
    const allowedProfiles = proxyConfig.allowProfiles;
    if (allowedProfiles.length > 0) {
        if (isPersistentBrowserProfileMutation(method, path)) {
            throw new Error("INVALID_REQUEST: browser.proxy cannot mutate persistent browser profiles when allowProfiles is configured");
        }
        if (path !== "/profiles") {
            const profileToCheck = requestedProfile || resolved.defaultProfile;
            if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: profileToCheck })) {
                throw new Error("INVALID_REQUEST: browser profile not allowed");
            }
        }
        else if (requestedProfile) {
            if (!isProfileAllowed({ allowProfiles: allowedProfiles, profile: requestedProfile })) {
                throw new Error("INVALID_REQUEST: browser profile not allowed");
            }
        }
    }
    const timeoutMs = resolveBrowserProxyTimeout(params.timeoutMs);
    const query = {};
    const rawQuery = params.query ?? {};
    for (const [key, value] of Object.entries(rawQuery)) {
        if (value === undefined || value === null) {
            continue;
        }
        query[key] = typeof value === "string" ? value : String(value);
    }
    if (requestedProfile) {
        query.profile = requestedProfile;
    }
    const dispatcher = createBrowserRouteDispatcher(createBrowserControlContext());
    let response;
    try {
        response = await withTimeout((signal) => dispatcher.dispatch({
            method: method === "DELETE" ? "DELETE" : method === "POST" ? "POST" : "GET",
            path,
            query,
            body,
            signal,
        }), timeoutMs, "browser proxy request");
    }
    catch (err) {
        if (!isBrowserProxyTimeoutError(err)) {
            throw err;
        }
        const profileForStatus = requestedProfile || resolved.defaultProfile;
        const status = await readBrowserProxyStatus({
            dispatcher,
            profile: path === "/profiles" ? undefined : profileForStatus,
        });
        throw new Error(formatBrowserProxyTimeoutMessage({
            method,
            path,
            profile: path === "/profiles" ? undefined : profileForStatus || undefined,
            timeoutMs,
            wsBacked: isWsBackedBrowserProxyPath(path),
            status,
        }), { cause: err });
    }
    if (response.status >= 400) {
        const message = response.body && typeof response.body === "object" && "error" in response.body
            ? String(response.body.error)
            : `HTTP ${response.status}`;
        throw new Error(message);
    }
    const result = response.body;
    if (allowedProfiles.length > 0 && path === "/profiles") {
        const obj = typeof result === "object" && result !== null ? result : {};
        const profiles = Array.isArray(obj.profiles) ? obj.profiles : [];
        obj.profiles = profiles.filter((entry) => {
            if (!entry || typeof entry !== "object") {
                return false;
            }
            const name = entry.name;
            return typeof name === "string" && allowedProfiles.includes(name);
        });
    }
    let files;
    const paths = collectBrowserProxyPaths(result);
    if (paths.length > 0) {
        const loaded = await Promise.all(paths.map(async (p) => {
            try {
                const file = await readBrowserProxyFile(p);
                if (!file) {
                    throw new Error("file not found");
                }
                return file;
            }
            catch (err) {
                throw new Error(`browser proxy file read failed for ${p}: ${String(err)}`, {
                    cause: err,
                });
            }
        }));
        if (loaded.length > 0) {
            files = loaded;
        }
    }
    const payload = files ? { result, files } : { result };
    return JSON.stringify(payload);
}
