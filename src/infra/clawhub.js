import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAtLeast, parseSemver } from "./runtime-guard.js";
import { compareComparableSemver, parseComparableSemver } from "./semver-compare.js";
const DEFAULT_CLAWHUB_URL = "https://clawhub.ai";
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
export class ClawHubRequestError extends Error {
    status;
    requestPath;
    responseBody;
    constructor(params) {
        super(`ClawHub ${params.path} failed (${params.status}): ${params.body}`);
        this.name = "ClawHubRequestError";
        this.status = params.status;
        this.requestPath = params.path;
        this.responseBody = params.body;
    }
}
function normalizeBaseUrl(baseUrl) {
    const envValue = process.env.OPENCLAW_CLAWHUB_URL?.trim() ||
        process.env.CLAWHUB_URL?.trim() ||
        DEFAULT_CLAWHUB_URL;
    const value = (baseUrl?.trim() || envValue).replace(/\/+$/, "");
    return value || DEFAULT_CLAWHUB_URL;
}
function readNonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function extractTokenFromClawHubConfig(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    return (readNonEmptyString(record.accessToken) ??
        readNonEmptyString(record.authToken) ??
        readNonEmptyString(record.apiToken) ??
        readNonEmptyString(record.token) ??
        extractTokenFromClawHubConfig(record.auth) ??
        extractTokenFromClawHubConfig(record.session) ??
        extractTokenFromClawHubConfig(record.credentials) ??
        extractTokenFromClawHubConfig(record.user));
}
function resolveClawHubConfigPaths() {
    const explicit = process.env.OPENCLAW_CLAWHUB_CONFIG_PATH?.trim() ||
        process.env.CLAWHUB_CONFIG_PATH?.trim() ||
        process.env.CLAWDHUB_CONFIG_PATH?.trim(); // legacy misspelling from older clawhub CLI builds; keep for back-compat
    if (explicit) {
        return [explicit];
    }
    const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
    const configHome = xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : path.join(os.homedir(), ".config");
    const xdgPath = path.join(configHome, "clawhub", "config.json");
    if (process.platform === "darwin") {
        return [
            path.join(os.homedir(), "Library", "Application Support", "clawhub", "config.json"),
            xdgPath,
        ];
    }
    return [xdgPath];
}
export async function resolveClawHubAuthToken() {
    const envToken = process.env.OPENCLAW_CLAWHUB_TOKEN?.trim() ||
        process.env.CLAWHUB_TOKEN?.trim() ||
        process.env.CLAWHUB_AUTH_TOKEN?.trim();
    if (envToken) {
        return envToken;
    }
    for (const configPath of resolveClawHubConfigPaths()) {
        try {
            const raw = await fs.readFile(configPath, "utf8");
            const token = extractTokenFromClawHubConfig(JSON.parse(raw));
            if (token) {
                return token;
            }
        }
        catch {
            // Try the next candidate path.
        }
    }
    return undefined;
}
function compareSemver(left, right) {
    return compareComparableSemver(parseComparableSemver(left), parseComparableSemver(right));
}
function upperBoundForCaret(version) {
    const parsed = parseComparableSemver(version);
    if (!parsed) {
        return null;
    }
    if (parsed.major > 0) {
        return `${parsed.major + 1}.0.0`;
    }
    if (parsed.minor > 0) {
        return `0.${parsed.minor + 1}.0`;
    }
    return `0.0.${parsed.patch + 1}`;
}
function satisfiesComparator(version, token) {
    const trimmed = token.trim();
    if (!trimmed) {
        return true;
    }
    if (trimmed.startsWith("^")) {
        const base = trimmed.slice(1).trim();
        const upperBound = upperBoundForCaret(base);
        const lowerCmp = compareSemver(version, base);
        const upperCmp = upperBound ? compareSemver(version, upperBound) : null;
        return lowerCmp != null && upperCmp != null && lowerCmp >= 0 && upperCmp < 0;
    }
    const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(trimmed);
    if (!match) {
        return false;
    }
    const operator = match[1] ?? "=";
    const target = match[2]?.trim();
    if (!target) {
        return false;
    }
    const cmp = compareSemver(version, target);
    if (cmp == null) {
        return false;
    }
    switch (operator) {
        case ">=":
            return cmp >= 0;
        case "<=":
            return cmp <= 0;
        case ">":
            return cmp > 0;
        case "<":
            return cmp < 0;
        case "=":
        default:
            return cmp === 0;
    }
}
function satisfiesSemverRange(version, range) {
    const tokens = range
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
    if (tokens.length === 0) {
        return false;
    }
    return tokens.every((token) => satisfiesComparator(version, token));
}
function buildUrl(params) {
    const url = new URL(params.path, `${normalizeBaseUrl(params.baseUrl)}/`);
    for (const [key, value] of Object.entries(params.search ?? {})) {
        if (!value) {
            continue;
        }
        url.searchParams.set(key, value);
    }
    return url;
}
async function clawhubRequest(params) {
    const url = buildUrl(params);
    const token = params.token?.trim() || (await resolveClawHubAuthToken());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`ClawHub request timed out after ${params.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS}ms`)), params.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    try {
        const response = await (params.fetchImpl ?? fetch)(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: controller.signal,
        });
        return { response, url };
    }
    finally {
        clearTimeout(timeout);
    }
}
async function readErrorBody(response) {
    try {
        const text = (await response.text()).trim();
        return text || response.statusText || `HTTP ${response.status}`;
    }
    catch {
        return response.statusText || `HTTP ${response.status}`;
    }
}
async function fetchJson(params) {
    const { response, url } = await clawhubRequest(params);
    if (!response.ok) {
        throw new ClawHubRequestError({
            path: url.pathname,
            status: response.status,
            body: await readErrorBody(response),
        });
    }
    return (await response.json());
}
export function resolveClawHubBaseUrl(baseUrl) {
    return normalizeBaseUrl(baseUrl);
}
export function formatSha256Integrity(bytes) {
    const digest = createHash("sha256").update(bytes).digest("base64");
    return `sha256-${digest}`;
}
export function parseClawHubPluginSpec(raw) {
    const trimmed = raw.trim();
    if (!trimmed.toLowerCase().startsWith("clawhub:")) {
        return null;
    }
    const spec = trimmed.slice("clawhub:".length).trim();
    if (!spec) {
        return null;
    }
    const atIndex = spec.lastIndexOf("@");
    if (atIndex <= 0 || atIndex >= spec.length - 1) {
        return { name: spec };
    }
    return {
        name: spec.slice(0, atIndex).trim(),
        version: spec.slice(atIndex + 1).trim() || undefined,
    };
}
export async function fetchClawHubPackageDetail(params) {
    return await fetchJson({
        baseUrl: params.baseUrl,
        path: `/api/v1/packages/${encodeURIComponent(params.name)}`,
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
    });
}
export async function fetchClawHubPackageVersion(params) {
    return await fetchJson({
        baseUrl: params.baseUrl,
        path: `/api/v1/packages/${encodeURIComponent(params.name)}/versions/${encodeURIComponent(params.version)}`,
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
    });
}
export async function searchClawHubPackages(params) {
    const result = await fetchJson({
        baseUrl: params.baseUrl,
        path: "/api/v1/packages/search",
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
        search: {
            q: params.query.trim(),
            family: params.family,
            limit: params.limit ? String(params.limit) : undefined,
        },
    });
    return result.results ?? [];
}
export async function searchClawHubSkills(params) {
    const result = await fetchJson({
        baseUrl: params.baseUrl,
        path: "/api/v1/search",
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
        search: {
            q: params.query.trim(),
            limit: params.limit ? String(params.limit) : undefined,
        },
    });
    return result.results ?? [];
}
export async function fetchClawHubSkillDetail(params) {
    return await fetchJson({
        baseUrl: params.baseUrl,
        path: `/api/v1/skills/${encodeURIComponent(params.slug)}`,
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
    });
}
export async function listClawHubSkills(params) {
    return await fetchJson({
        baseUrl: params.baseUrl,
        path: "/api/v1/skills",
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
        search: {
            limit: params.limit ? String(params.limit) : undefined,
        },
    });
}
export async function downloadClawHubPackageArchive(params) {
    const search = params.version
        ? { version: params.version }
        : params.tag
            ? { tag: params.tag }
            : undefined;
    const { response, url } = await clawhubRequest({
        baseUrl: params.baseUrl,
        path: `/api/v1/packages/${encodeURIComponent(params.name)}/download`,
        search,
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
    });
    if (!response.ok) {
        throw new ClawHubRequestError({
            path: url.pathname,
            status: response.status,
            body: await readErrorBody(response),
        });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-clawhub-package-"));
    const archivePath = path.join(tmpDir, `${params.name}.zip`);
    await fs.writeFile(archivePath, bytes);
    return {
        archivePath,
        integrity: formatSha256Integrity(bytes),
    };
}
export async function downloadClawHubSkillArchive(params) {
    const { response, url } = await clawhubRequest({
        baseUrl: params.baseUrl,
        path: "/api/v1/download",
        token: params.token,
        timeoutMs: params.timeoutMs,
        fetchImpl: params.fetchImpl,
        search: {
            slug: params.slug,
            version: params.version,
            tag: params.version ? undefined : params.tag,
        },
    });
    if (!response.ok) {
        throw new ClawHubRequestError({
            path: url.pathname,
            status: response.status,
            body: await readErrorBody(response),
        });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-clawhub-skill-"));
    const archivePath = path.join(tmpDir, `${params.slug}.zip`);
    await fs.writeFile(archivePath, bytes);
    return {
        archivePath,
        integrity: formatSha256Integrity(bytes),
    };
}
export function resolveLatestVersionFromPackage(detail) {
    return detail.package?.latestVersion ?? detail.package?.tags?.latest ?? null;
}
export function isClawHubFamilySkill(detail) {
    if ("package" in detail) {
        return detail.package?.family === "skill";
    }
    return Boolean(detail.skill);
}
export function satisfiesPluginApiRange(pluginApiVersion, pluginApiRange) {
    if (!pluginApiRange) {
        return true;
    }
    return satisfiesSemverRange(pluginApiVersion, pluginApiRange);
}
export function satisfiesGatewayMinimum(currentVersion, minGatewayVersion) {
    if (!minGatewayVersion) {
        return true;
    }
    const current = parseSemver(currentVersion);
    const minimum = parseSemver(minGatewayVersion);
    if (!current || !minimum) {
        return false;
    }
    return isAtLeast(current, minimum);
}
