import { resolveRuntimeServiceVersion } from "../version.js";
import { normalizeProviderId } from "./provider-id.js";
const OPENCLAW_ATTRIBUTION_PRODUCT = "OpenClaw";
const OPENCLAW_ATTRIBUTION_ORIGINATOR = "openclaw";
export function resolveProviderAttributionIdentity(env = process.env) {
    return {
        product: OPENCLAW_ATTRIBUTION_PRODUCT,
        version: resolveRuntimeServiceVersion(env),
    };
}
function buildOpenRouterAttributionPolicy(env = process.env) {
    const identity = resolveProviderAttributionIdentity(env);
    return {
        provider: "openrouter",
        enabledByDefault: true,
        verification: "vendor-documented",
        hook: "request-headers",
        docsUrl: "https://openrouter.ai/docs/app-attribution",
        reviewNote: "Documented app attribution headers. Verified in OpenClaw runtime wrapper.",
        ...identity,
        headers: {
            "HTTP-Referer": "https://openclaw.ai",
            "X-OpenRouter-Title": identity.product,
            "X-OpenRouter-Categories": "cli-agent",
        },
    };
}
function buildOpenAIAttributionPolicy(env = process.env) {
    const identity = resolveProviderAttributionIdentity(env);
    return {
        provider: "openai",
        enabledByDefault: true,
        verification: "vendor-hidden-api-spec",
        hook: "request-headers",
        reviewNote: "OpenAI native traffic supports hidden originator/User-Agent attribution. Verified against the Codex wire contract.",
        ...identity,
        headers: {
            originator: OPENCLAW_ATTRIBUTION_ORIGINATOR,
            version: identity.version,
            "User-Agent": `${OPENCLAW_ATTRIBUTION_ORIGINATOR}/${identity.version}`,
        },
    };
}
function buildOpenAICodexAttributionPolicy(env = process.env) {
    const identity = resolveProviderAttributionIdentity(env);
    return {
        provider: "openai-codex",
        enabledByDefault: true,
        verification: "vendor-hidden-api-spec",
        hook: "request-headers",
        reviewNote: "OpenAI Codex ChatGPT-backed traffic supports the same hidden originator/User-Agent attribution contract.",
        ...identity,
        headers: {
            originator: OPENCLAW_ATTRIBUTION_ORIGINATOR,
            version: identity.version,
            "User-Agent": `${OPENCLAW_ATTRIBUTION_ORIGINATOR}/${identity.version}`,
        },
    };
}
function buildSdkHookOnlyPolicy(provider, hook, reviewNote, env = process.env) {
    return {
        provider,
        enabledByDefault: false,
        verification: "vendor-sdk-hook-only",
        hook,
        reviewNote,
        ...resolveProviderAttributionIdentity(env),
    };
}
export function listProviderAttributionPolicies(env = process.env) {
    return [
        buildOpenRouterAttributionPolicy(env),
        buildOpenAIAttributionPolicy(env),
        buildOpenAICodexAttributionPolicy(env),
        buildSdkHookOnlyPolicy("anthropic", "default-headers", "Anthropic JS SDK exposes defaultHeaders, but app attribution is not yet verified.", env),
        buildSdkHookOnlyPolicy("google", "user-agent-extra", "Google GenAI JS SDK exposes userAgentExtra/httpOptions, but provider-side attribution is not yet verified.", env),
        buildSdkHookOnlyPolicy("groq", "default-headers", "Groq JS SDK exposes defaultHeaders, but app attribution is not yet verified.", env),
        buildSdkHookOnlyPolicy("mistral", "custom-user-agent", "Mistral JS SDK exposes a custom userAgent option, but app attribution is not yet verified.", env),
        buildSdkHookOnlyPolicy("together", "default-headers", "Together JS SDK exposes defaultHeaders, but app attribution is not yet verified.", env),
    ];
}
export function resolveProviderAttributionPolicy(provider, env = process.env) {
    const normalized = normalizeProviderId(provider ?? "");
    return listProviderAttributionPolicies(env).find((policy) => policy.provider === normalized);
}
export function resolveProviderAttributionHeaders(provider, env = process.env) {
    const policy = resolveProviderAttributionPolicy(provider, env);
    if (!policy?.enabledByDefault) {
        return undefined;
    }
    return policy.headers;
}
