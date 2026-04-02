import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
const ANTHROPIC_VERTEX_DEFAULT_REGION = "global";
const ANTHROPIC_VERTEX_REGION_RE = /^[a-z0-9-]+$/;
const GCP_VERTEX_CREDENTIALS_MARKER = "gcp-vertex-credentials";
const GCLOUD_DEFAULT_ADC_PATH = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
function normalizeOptionalSecretInput(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
export function resolveAnthropicVertexRegion(env = process.env) {
    const region = normalizeOptionalSecretInput(env.GOOGLE_CLOUD_LOCATION) ||
        normalizeOptionalSecretInput(env.CLOUD_ML_REGION);
    return region && ANTHROPIC_VERTEX_REGION_RE.test(region)
        ? region
        : ANTHROPIC_VERTEX_DEFAULT_REGION;
}
export function resolveAnthropicVertexProjectId(env = process.env) {
    return (normalizeOptionalSecretInput(env.ANTHROPIC_VERTEX_PROJECT_ID) ||
        normalizeOptionalSecretInput(env.GOOGLE_CLOUD_PROJECT) ||
        normalizeOptionalSecretInput(env.GOOGLE_CLOUD_PROJECT_ID) ||
        resolveAnthropicVertexProjectIdFromAdc(env));
}
export function resolveAnthropicVertexRegionFromBaseUrl(baseUrl) {
    const trimmed = baseUrl?.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        const host = new URL(trimmed).hostname.toLowerCase();
        if (host === "aiplatform.googleapis.com") {
            return "global";
        }
        const match = /^([a-z0-9-]+)-aiplatform\.googleapis\.com$/.exec(host);
        return match?.[1];
    }
    catch {
        return undefined;
    }
}
export function resolveAnthropicVertexClientRegion(params) {
    return (resolveAnthropicVertexRegionFromBaseUrl(params?.baseUrl) ||
        resolveAnthropicVertexRegion(params?.env));
}
function hasAnthropicVertexMetadataServerAdc(env = process.env) {
    const explicitMetadataOptIn = normalizeOptionalSecretInput(env.ANTHROPIC_VERTEX_USE_GCP_METADATA);
    return explicitMetadataOptIn === "1" || explicitMetadataOptIn?.toLowerCase() === "true";
}
function resolveAnthropicVertexDefaultAdcPath(env = process.env) {
    return platform() === "win32"
        ? join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "gcloud", "application_default_credentials.json")
        : GCLOUD_DEFAULT_ADC_PATH;
}
function resolveAnthropicVertexAdcCredentialsPath(env = process.env) {
    const explicitCredentialsPath = normalizeOptionalSecretInput(env.GOOGLE_APPLICATION_CREDENTIALS);
    if (explicitCredentialsPath) {
        return existsSync(explicitCredentialsPath) ? explicitCredentialsPath : undefined;
    }
    const defaultAdcPath = resolveAnthropicVertexDefaultAdcPath(env);
    return existsSync(defaultAdcPath) ? defaultAdcPath : undefined;
}
function resolveAnthropicVertexProjectIdFromAdc(env = process.env) {
    const credentialsPath = resolveAnthropicVertexAdcCredentialsPath(env);
    if (!credentialsPath) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(readFileSync(credentialsPath, "utf8"));
        return (normalizeOptionalSecretInput(parsed.project_id) ||
            normalizeOptionalSecretInput(parsed.quota_project_id));
    }
    catch {
        return undefined;
    }
}
export function hasAnthropicVertexCredentials(env = process.env) {
    return (hasAnthropicVertexMetadataServerAdc(env) ||
        resolveAnthropicVertexAdcCredentialsPath(env) !== undefined);
}
export function hasAnthropicVertexAvailableAuth(env = process.env) {
    return hasAnthropicVertexCredentials(env);
}
export function resolveAnthropicVertexConfigApiKey(env = process.env) {
    return hasAnthropicVertexAvailableAuth(env) ? GCP_VERTEX_CREDENTIALS_MARKER : undefined;
}
