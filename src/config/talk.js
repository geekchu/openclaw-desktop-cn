import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { coerceSecretRef } from "./types.secrets.js";
export const LEGACY_TALK_PROVIDER_ID = "elevenlabs";
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function normalizeVoiceAliases(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const aliases = {};
    for (const [alias, rawId] of Object.entries(value)) {
        if (typeof rawId !== "string") {
            continue;
        }
        aliases[alias] = rawId;
    }
    return Object.keys(aliases).length > 0 ? aliases : undefined;
}
function normalizeTalkSecretInput(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return coerceSecretRef(value) ?? undefined;
}
function normalizeSilenceTimeoutMs(value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        return undefined;
    }
    return value;
}
function normalizeTalkProviderConfig(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const provider = {};
    for (const [key, raw] of Object.entries(value)) {
        if (raw === undefined) {
            continue;
        }
        if (key === "voiceAliases") {
            const aliases = normalizeVoiceAliases(raw);
            if (aliases) {
                provider.voiceAliases = aliases;
            }
            continue;
        }
        if (key === "apiKey") {
            const normalized = normalizeTalkSecretInput(raw);
            if (normalized !== undefined) {
                provider.apiKey = normalized;
            }
            continue;
        }
        if (key === "voiceId" || key === "modelId" || key === "outputFormat") {
            const normalized = normalizeString(raw);
            if (normalized) {
                provider[key] = normalized;
            }
            continue;
        }
        provider[key] = raw;
    }
    return Object.keys(provider).length > 0 ? provider : undefined;
}
function normalizeTalkProviders(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const providers = {};
    for (const [rawProviderId, providerConfig] of Object.entries(value)) {
        const providerId = normalizeString(rawProviderId);
        if (!providerId) {
            continue;
        }
        const normalizedProvider = normalizeTalkProviderConfig(providerConfig);
        if (!normalizedProvider) {
            continue;
        }
        providers[providerId] = normalizedProvider;
    }
    return Object.keys(providers).length > 0 ? providers : undefined;
}
function normalizedLegacyTalkFields(source) {
    const legacy = {};
    const voiceId = normalizeString(source.voiceId);
    if (voiceId) {
        legacy.voiceId = voiceId;
    }
    const voiceAliases = normalizeVoiceAliases(source.voiceAliases);
    if (voiceAliases) {
        legacy.voiceAliases = voiceAliases;
    }
    const modelId = normalizeString(source.modelId);
    if (modelId) {
        legacy.modelId = modelId;
    }
    const outputFormat = normalizeString(source.outputFormat);
    if (outputFormat) {
        legacy.outputFormat = outputFormat;
    }
    const apiKey = normalizeTalkSecretInput(source.apiKey);
    if (apiKey !== undefined) {
        legacy.apiKey = apiKey;
    }
    const silenceTimeoutMs = normalizeSilenceTimeoutMs(source.silenceTimeoutMs);
    if (silenceTimeoutMs !== undefined) {
        legacy.silenceTimeoutMs = silenceTimeoutMs;
    }
    return legacy;
}
function legacyProviderConfigFromTalk(source) {
    return normalizeTalkProviderConfig({
        voiceId: source.voiceId,
        voiceAliases: source.voiceAliases,
        modelId: source.modelId,
        outputFormat: source.outputFormat,
        apiKey: source.apiKey,
    });
}
function activeProviderFromTalk(talk) {
    const provider = normalizeString(talk.provider);
    const providers = talk.providers;
    if (provider) {
        if (providers && !(provider in providers)) {
            return undefined;
        }
        return provider;
    }
    const providerIds = providers ? Object.keys(providers) : [];
    return providerIds.length === 1 ? providerIds[0] : undefined;
}
function legacyTalkFieldsFromProviderConfig(config) {
    if (!config) {
        return {};
    }
    const legacy = {};
    if (typeof config.voiceId === "string") {
        legacy.voiceId = config.voiceId;
    }
    if (config.voiceAliases &&
        typeof config.voiceAliases === "object" &&
        !Array.isArray(config.voiceAliases)) {
        const aliases = normalizeVoiceAliases(config.voiceAliases);
        if (aliases) {
            legacy.voiceAliases = aliases;
        }
    }
    if (typeof config.modelId === "string") {
        legacy.modelId = config.modelId;
    }
    if (typeof config.outputFormat === "string") {
        legacy.outputFormat = config.outputFormat;
    }
    if (config.apiKey !== undefined) {
        legacy.apiKey = config.apiKey;
    }
    return legacy;
}
export function normalizeTalkSection(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const source = value;
    const hasNormalizedShape = typeof source.provider === "string" || isPlainObject(source.providers);
    const normalized = {};
    const legacy = normalizedLegacyTalkFields(source);
    if (Object.keys(legacy).length > 0) {
        Object.assign(normalized, legacy);
    }
    if (typeof source.interruptOnSpeech === "boolean") {
        normalized.interruptOnSpeech = source.interruptOnSpeech;
    }
    if (hasNormalizedShape) {
        const providers = normalizeTalkProviders(source.providers);
        const provider = normalizeString(source.provider);
        if (providers) {
            normalized.providers = providers;
        }
        if (provider) {
            normalized.provider = provider;
        }
        return Object.keys(normalized).length > 0 ? normalized : undefined;
    }
    const legacyProviderConfig = legacyProviderConfigFromTalk(source);
    if (legacyProviderConfig) {
        normalized.providers = { [LEGACY_TALK_PROVIDER_ID]: legacyProviderConfig };
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}
export function normalizeTalkConfig(config) {
    if (!config.talk) {
        return config;
    }
    const normalizedTalk = normalizeTalkSection(config.talk);
    if (!normalizedTalk) {
        return config;
    }
    return {
        ...config,
        talk: normalizedTalk,
    };
}
export function resolveActiveTalkProviderConfig(talk) {
    const normalizedTalk = normalizeTalkSection(talk);
    if (!normalizedTalk) {
        return undefined;
    }
    const provider = activeProviderFromTalk(normalizedTalk);
    if (!provider) {
        return undefined;
    }
    return {
        provider,
        config: normalizedTalk.providers?.[provider] ?? {},
    };
}
export function buildTalkConfigResponse(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const normalized = normalizeTalkSection(value);
    if (!normalized) {
        return undefined;
    }
    const payload = {};
    if (typeof normalized.interruptOnSpeech === "boolean") {
        payload.interruptOnSpeech = normalized.interruptOnSpeech;
    }
    if (typeof normalized.silenceTimeoutMs === "number") {
        payload.silenceTimeoutMs = normalized.silenceTimeoutMs;
    }
    if (normalized.providers && Object.keys(normalized.providers).length > 0) {
        payload.providers = normalized.providers;
    }
    if (typeof normalized.provider === "string") {
        payload.provider = normalized.provider;
    }
    const resolved = resolveActiveTalkProviderConfig(normalized);
    if (resolved) {
        payload.resolved = resolved;
    }
    const providerConfig = resolved?.config;
    const providerCompatibilityLegacy = legacyTalkFieldsFromProviderConfig(providerConfig);
    const compatibilityLegacy = Object.keys(providerCompatibilityLegacy).length > 0
        ? providerCompatibilityLegacy
        : normalizedLegacyTalkFields(normalized);
    Object.assign(payload, compatibilityLegacy);
    return Object.keys(payload).length > 0 ? payload : undefined;
}
export function readTalkApiKeyFromProfile(deps = {}) {
    const fsImpl = deps.fs ?? fs;
    const osImpl = deps.os ?? os;
    const pathImpl = deps.path ?? path;
    const home = osImpl.homedir();
    const candidates = [".profile", ".zprofile", ".zshrc", ".bashrc"].map((name) => pathImpl.join(home, name));
    for (const candidate of candidates) {
        if (!fsImpl.existsSync(candidate)) {
            continue;
        }
        try {
            const text = fsImpl.readFileSync(candidate, "utf-8");
            const match = text.match(/(?:^|\n)\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*["']?([^\n"']+)["']?/);
            const value = match?.[1]?.trim();
            if (value) {
                return value;
            }
        }
        catch {
            // Ignore profile read errors.
        }
    }
    return null;
}
export function resolveTalkApiKey(env = process.env, deps = {}) {
    const envValue = (env.ELEVENLABS_API_KEY ?? "").trim();
    if (envValue) {
        return envValue;
    }
    return readTalkApiKeyFromProfile(deps);
}
