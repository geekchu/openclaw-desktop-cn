import fs from "node:fs";
import path from "node:path";
import * as PiCodingAgent from "@mariozechner/pi-coding-agent";
import { normalizeModelCompat } from "../plugins/provider-model-compat.js";
import { normalizeProviderResolvedModelWithPlugin } from "../plugins/provider-runtime.js";
import { ensureAuthProfileStore } from "./auth-profiles.js";
import { PROVIDER_ENV_API_KEY_CANDIDATES } from "./model-auth-env-vars.js";
import { resolveEnvApiKey } from "./model-auth-env.js";
import { resolvePiCredentialMapFromStore } from "./pi-auth-credentials.js";
const PiAuthStorageClass = PiCodingAgent.AuthStorage;
const PiModelRegistryClass = PiCodingAgent.ModelRegistry;
export { PiAuthStorageClass as AuthStorage, PiModelRegistryClass as ModelRegistry };
function createInMemoryAuthStorageBackend(initialData) {
    let snapshot = JSON.stringify(initialData, null, 2);
    return {
        withLock(update) {
            const { result, next } = update(snapshot);
            if (typeof next === "string") {
                snapshot = next;
            }
            return result;
        },
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeRegistryModel(value, agentDir) {
    if (!isRecord(value)) {
        return value;
    }
    if (typeof value.id !== "string" ||
        typeof value.name !== "string" ||
        typeof value.provider !== "string" ||
        typeof value.api !== "string") {
        return value;
    }
    const model = value;
    const pluginNormalized = normalizeProviderResolvedModelWithPlugin({
        provider: model.provider,
        context: {
            provider: model.provider,
            modelId: model.id,
            model,
            agentDir,
        },
    }) ?? model;
    return normalizeModelCompat(pluginNormalized);
}
class OpenClawModelRegistry extends PiModelRegistryClass {
    agentDir;
    constructor(authStorage, modelsJsonPath, agentDir) {
        super(authStorage, modelsJsonPath);
        this.agentDir = agentDir;
    }
    getAll() {
        return super.getAll().map((entry) => normalizeRegistryModel(entry, this.agentDir));
    }
    getAvailable() {
        return super.getAvailable().map((entry) => normalizeRegistryModel(entry, this.agentDir));
    }
    find(provider, modelId) {
        return normalizeRegistryModel(super.find(provider, modelId), this.agentDir);
    }
}
function scrubLegacyStaticAuthJsonEntries(pathname) {
    if (process.env.OPENCLAW_AUTH_STORE_READONLY === "1") {
        return;
    }
    if (!fs.existsSync(pathname)) {
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(pathname, "utf8"));
    }
    catch {
        return;
    }
    if (!isRecord(parsed)) {
        return;
    }
    let changed = false;
    for (const [provider, value] of Object.entries(parsed)) {
        if (!isRecord(value)) {
            continue;
        }
        if (value.type !== "api_key") {
            continue;
        }
        delete parsed[provider];
        changed = true;
    }
    if (!changed) {
        return;
    }
    if (Object.keys(parsed).length === 0) {
        fs.rmSync(pathname, { force: true });
        return;
    }
    fs.writeFileSync(pathname, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    fs.chmodSync(pathname, 0o600);
}
function createAuthStorage(AuthStorageLike, path, creds) {
    const withInMemory = AuthStorageLike;
    if (typeof withInMemory.inMemory === "function") {
        return withInMemory.inMemory(creds);
    }
    const withFromStorage = AuthStorageLike;
    if (typeof withFromStorage.fromStorage === "function") {
        const backendCtor = PiCodingAgent.InMemoryAuthStorageBackend;
        const backend = typeof backendCtor === "function"
            ? new backendCtor()
            : createInMemoryAuthStorageBackend(creds);
        backend.withLock(() => ({
            result: undefined,
            next: JSON.stringify(creds, null, 2),
        }));
        return withFromStorage.fromStorage(backend);
    }
    const withFactory = AuthStorageLike;
    const withRuntimeOverride = (typeof withFactory.create === "function"
        ? withFactory.create(path)
        : new AuthStorageLike(path));
    const hasRuntimeApiKeyOverride = typeof withRuntimeOverride.setRuntimeApiKey === "function"; // pragma: allowlist secret
    if (hasRuntimeApiKeyOverride) {
        for (const [provider, credential] of Object.entries(creds)) {
            if (credential.type === "api_key") {
                withRuntimeOverride.setRuntimeApiKey(provider, credential.key);
                continue;
            }
            withRuntimeOverride.setRuntimeApiKey(provider, credential.access);
        }
    }
    return withRuntimeOverride;
}
function resolvePiCredentials(agentDir) {
    const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
    const credentials = resolvePiCredentialMapFromStore(store);
    // pi-coding-agent hides providers from its registry when auth storage lacks
    // a matching credential entry. Mirror env-backed provider auth here so
    // live/model discovery sees the same providers runtime auth can use.
    for (const provider of Object.keys(PROVIDER_ENV_API_KEY_CANDIDATES)) {
        if (credentials[provider]) {
            continue;
        }
        const resolved = resolveEnvApiKey(provider);
        if (!resolved?.apiKey) {
            continue;
        }
        credentials[provider] = {
            type: "api_key",
            key: resolved.apiKey,
        };
    }
    return credentials;
}
// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir) {
    const credentials = resolvePiCredentials(agentDir);
    const authPath = path.join(agentDir, "auth.json");
    scrubLegacyStaticAuthJsonEntries(authPath);
    return createAuthStorage(PiAuthStorageClass, authPath, credentials);
}
export function discoverModels(authStorage, agentDir) {
    return new OpenClawModelRegistry(authStorage, path.join(agentDir, "models.json"), agentDir);
}
