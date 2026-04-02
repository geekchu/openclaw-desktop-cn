export const DEFAULT_SECRET_PROVIDER_ALIAS = "default"; // pragma: allowlist secret
export const ENV_SECRET_REF_ID_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const ENV_SECRET_TEMPLATE_RE = /^\$\{([A-Z][A-Z0-9_]{0,127})\}$/;
export function isValidEnvSecretRefId(value) {
    return ENV_SECRET_REF_ID_RE.test(value);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isSecretRef(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (Object.keys(value).length !== 3) {
        return false;
    }
    return ((value.source === "env" || value.source === "file" || value.source === "exec") &&
        typeof value.provider === "string" &&
        value.provider.trim().length > 0 &&
        typeof value.id === "string" &&
        value.id.trim().length > 0);
}
function isLegacySecretRefWithoutProvider(value) {
    if (!isRecord(value)) {
        return false;
    }
    return ((value.source === "env" || value.source === "file" || value.source === "exec") &&
        typeof value.id === "string" &&
        value.id.trim().length > 0 &&
        value.provider === undefined);
}
export function parseEnvTemplateSecretRef(value, provider = DEFAULT_SECRET_PROVIDER_ALIAS) {
    if (typeof value !== "string") {
        return null;
    }
    const match = ENV_SECRET_TEMPLATE_RE.exec(value.trim());
    if (!match) {
        return null;
    }
    return {
        source: "env",
        provider: provider.trim() || DEFAULT_SECRET_PROVIDER_ALIAS,
        id: match[1],
    };
}
export function coerceSecretRef(value, defaults) {
    if (isSecretRef(value)) {
        return value;
    }
    if (isLegacySecretRefWithoutProvider(value)) {
        const provider = value.source === "env"
            ? (defaults?.env ?? DEFAULT_SECRET_PROVIDER_ALIAS)
            : value.source === "file"
                ? (defaults?.file ?? DEFAULT_SECRET_PROVIDER_ALIAS)
                : (defaults?.exec ?? DEFAULT_SECRET_PROVIDER_ALIAS);
        return {
            source: value.source,
            provider,
            id: value.id,
        };
    }
    const envTemplate = parseEnvTemplateSecretRef(value, defaults?.env);
    if (envTemplate) {
        return envTemplate;
    }
    return null;
}
export function hasConfiguredSecretInput(value, defaults) {
    if (normalizeSecretInputString(value)) {
        return true;
    }
    return coerceSecretRef(value, defaults) !== null;
}
export function normalizeSecretInputString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function formatSecretRefLabel(ref) {
    return `${ref.source}:${ref.provider}:${ref.id}`;
}
export function assertSecretInputResolved(params) {
    const { ref } = resolveSecretInputRef({
        value: params.value,
        refValue: params.refValue,
        defaults: params.defaults,
    });
    if (!ref) {
        return;
    }
    throw new Error(`${params.path}: unresolved SecretRef "${formatSecretRefLabel(ref)}". Resolve this command against an active gateway runtime snapshot before reading it.`);
}
export function normalizeResolvedSecretInputString(params) {
    const normalized = normalizeSecretInputString(params.value);
    if (normalized) {
        return normalized;
    }
    assertSecretInputResolved(params);
    return undefined;
}
export function resolveSecretInputRef(params) {
    const explicitRef = coerceSecretRef(params.refValue, params.defaults);
    const inlineRef = explicitRef ? null : coerceSecretRef(params.value, params.defaults);
    return {
        explicitRef,
        inlineRef,
        ref: explicitRef ?? inlineRef,
    };
}
