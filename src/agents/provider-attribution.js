import { normalizeOptionalLowercaseString, normalizeOptionalString, } from "../shared/string-coerce.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { normalizeProviderId } from "./provider-id.js";
const OPENCLAW_ATTRIBUTION_PRODUCT = "OpenClaw";
const OPENCLAW_ATTRIBUTION_ORIGINATOR = "openclaw";
const LOCAL_ENDPOINT_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MOONSHOT_NATIVE_BASE_URLS = new Set([
    "https://api.moonshot.ai/v1",
    "https://api.moonshot.cn/v1",
]);
const MODELSTUDIO_NATIVE_BASE_URLS = new Set([
    "https://coding-intl.dashscope.aliyuncs.com/v1",
    "https://coding.dashscope.aliyuncs.com/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
]);
const OPENAI_RESPONSES_APIS = new Set(["openai-responses", "azure-openai-responses"]);
const OPENAI_RESPONSES_PROVIDERS = new Set(["openai", "azure-openai", "azure-openai-responses"]);
const MOONSHOT_COMPAT_PROVIDERS = new Set(["moonshot", "kimi"]);
function formatOpenClawUserAgent(version) {
    return `${OPENCLAW_ATTRIBUTION_ORIGINATOR}/${version}`;
}
function tryParseHostname(value) {
    try {
        return normalizeOptionalLowercaseString(new URL(value).hostname);
    }
    catch {
        return undefined;
    }
}
function isSchemelessHostnameCandidate(value) {
    return /^[a-z0-9.[\]-]+(?::\d+)?(?:[/?#].*)?$/i.test(value);
}
function resolveUrlHostname(value) {
    const trimmed = normalizeOptionalString(value);
    if (!trimmed) {
        return undefined;
    }
    const parsedHostname = tryParseHostname(trimmed);
    if (parsedHostname) {
        return parsedHostname;
    }
    if (!isSchemelessHostnameCandidate(trimmed)) {
        return undefined;
    }
    return tryParseHostname(`https://${trimmed}`);
}
function normalizeComparableBaseUrl(value) {
    const trimmed = normalizeOptionalString(value);
    if (!trimmed) {
        return undefined;
    }
    const parsedValue = tryParseHostname(trimmed) || !isSchemelessHostnameCandidate(trimmed)
        ? trimmed
        : `https://${trimmed}`;
    try {
        const url = new URL(parsedValue);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return undefined;
        }
        url.hash = "";
        url.search = "";
        return normalizeOptionalLowercaseString(url.toString().replace(/\/+$/, ""));
    }
    catch {
        return undefined;
    }
}
function isLocalEndpointHost(host) {
    return (LOCAL_ENDPOINT_HOSTS.has(host) ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal"));
}
export function resolveProviderEndpoint(baseUrl) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
        return { endpointClass: "default" };
    }
    const host = resolveUrlHostname(baseUrl);
    if (!host) {
        return { endpointClass: "invalid" };
    }
    const normalizedBaseUrl = normalizeComparableBaseUrl(baseUrl);
    if (normalizedBaseUrl && MOONSHOT_NATIVE_BASE_URLS.has(normalizedBaseUrl)) {
        return { endpointClass: "moonshot-native", hostname: host };
    }
    if (normalizedBaseUrl && MODELSTUDIO_NATIVE_BASE_URLS.has(normalizedBaseUrl)) {
        return { endpointClass: "modelstudio-native", hostname: host };
    }
    if (host === "api.openai.com") {
        return { endpointClass: "openai-public", hostname: host };
    }
    if (host === "api.anthropic.com") {
        return { endpointClass: "anthropic-public", hostname: host };
    }
    if (host === "api.mistral.ai") {
        return { endpointClass: "mistral-public", hostname: host };
    }
    if (host === "api.cerebras.ai") {
        return { endpointClass: "cerebras-native", hostname: host };
    }
    if (host === "llm.chutes.ai") {
        return { endpointClass: "chutes-native", hostname: host };
    }
    if (host === "api.deepseek.com") {
        return { endpointClass: "deepseek-native", hostname: host };
    }
    if (host.endsWith(".githubcopilot.com")) {
        return { endpointClass: "github-copilot-native", hostname: host };
    }
    if (host === "api.groq.com") {
        return { endpointClass: "groq-native", hostname: host };
    }
    if (host === "chatgpt.com") {
        return { endpointClass: "openai-codex", hostname: host };
    }
    if (host === "opencode.ai" || host.endsWith(".opencode.ai")) {
        return { endpointClass: "opencode-native", hostname: host };
    }
    if (host === "openrouter.ai" || host.endsWith(".openrouter.ai")) {
        return { endpointClass: "openrouter", hostname: host };
    }
    if (host === "api.x.ai" || host === "api.grok.x.ai") {
        return { endpointClass: "xai-native", hostname: host };
    }
    if (host === "api.z.ai") {
        return { endpointClass: "zai-native", hostname: host };
    }
    if (host.endsWith(".openai.azure.com")) {
        return { endpointClass: "azure-openai", hostname: host };
    }
    if (host === "generativelanguage.googleapis.com") {
        return { endpointClass: "google-generative-ai", hostname: host };
    }
    if (host === "aiplatform.googleapis.com") {
        return {
            endpointClass: "google-vertex",
            hostname: host,
            googleVertexRegion: "global",
        };
    }
    const googleVertexHost = /^([a-z0-9-]+)-aiplatform\.googleapis\.com$/.exec(host);
    if (googleVertexHost) {
        return {
            endpointClass: "google-vertex",
            hostname: host,
            googleVertexRegion: googleVertexHost[1],
        };
    }
    if (isLocalEndpointHost(host)) {
        return { endpointClass: "local", hostname: host };
    }
    return { endpointClass: "custom", hostname: host };
}
function resolveKnownProviderFamily(provider) {
    switch (provider) {
        case "openai":
        case "openai-codex":
        case "azure-openai":
        case "azure-openai-responses":
            return "openai-family";
        case "openrouter":
            return "openrouter";
        case "anthropic":
            return "anthropic";
        case "chutes":
            return "chutes";
        case "deepseek":
            return "deepseek";
        case "google":
            return "google";
        case "xai":
            return "xai";
        case "zai":
            return "zai";
        case "moonshot":
        case "kimi":
            return "moonshot";
        case "qwen":
        case "qwencloud":
        case "modelstudio":
        case "dashscope":
            return "modelstudio";
        case "github-copilot":
            return "github-copilot";
        case "groq":
            return "groq";
        case "mistral":
            return "mistral";
        case "together":
            return "together";
        default:
            return provider || "unknown";
    }
}
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
            "User-Agent": formatOpenClawUserAgent(identity.version),
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
            "User-Agent": formatOpenClawUserAgent(identity.version),
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
export function resolveProviderRequestPolicy(input, env = process.env) {
    const provider = normalizeProviderId(input.provider ?? "");
    const policy = resolveProviderAttributionPolicy(provider, env);
    const endpointResolution = resolveProviderEndpoint(input.baseUrl);
    const endpointClass = endpointResolution.endpointClass;
    const api = normalizeOptionalLowercaseString(input.api);
    const usesConfiguredBaseUrl = endpointClass !== "default";
    const usesKnownNativeOpenAIEndpoint = endpointClass === "openai-public" ||
        endpointClass === "openai-codex" ||
        endpointClass === "azure-openai";
    const usesOpenAIPublicAttributionHost = endpointClass === "openai-public";
    const usesOpenAICodexAttributionHost = endpointClass === "openai-codex";
    const usesVerifiedOpenAIAttributionHost = usesOpenAIPublicAttributionHost || usesOpenAICodexAttributionHost;
    const usesExplicitProxyLikeEndpoint = usesConfiguredBaseUrl && !usesKnownNativeOpenAIEndpoint;
    let attributionProvider;
    if (provider === "openai" &&
        (api === "openai-completions" ||
            api === "openai-responses" ||
            (input.capability === "audio" && api === "openai-audio-transcriptions")) &&
        usesOpenAIPublicAttributionHost) {
        attributionProvider = "openai";
    }
    else if (provider === "openai-codex" &&
        (api === "openai-codex-responses" || api === "openai-responses") &&
        usesOpenAICodexAttributionHost) {
        attributionProvider = "openai-codex";
    }
    else if (provider === "openrouter" && policy?.enabledByDefault) {
        // OpenRouter attribution is documented, but only apply it to known
        // OpenRouter endpoints or the default (unset) baseUrl path.
        if (endpointClass === "openrouter" || endpointClass === "default") {
            attributionProvider = "openrouter";
        }
    }
    const attributionHeaders = attributionProvider
        ? resolveProviderAttributionHeaders(attributionProvider, env)
        : undefined;
    return {
        provider: provider || undefined,
        policy,
        endpointClass,
        usesConfiguredBaseUrl,
        knownProviderFamily: resolveKnownProviderFamily(provider || undefined),
        attributionProvider,
        attributionHeaders,
        allowsHiddenAttribution: attributionProvider !== undefined && policy?.verification === "vendor-hidden-api-spec",
        usesKnownNativeOpenAIEndpoint,
        usesKnownNativeOpenAIRoute: endpointClass === "default" ? provider === "openai" : usesKnownNativeOpenAIEndpoint,
        usesVerifiedOpenAIAttributionHost,
        usesExplicitProxyLikeEndpoint,
    };
}
export function resolveProviderRequestAttributionHeaders(input, env = process.env) {
    return resolveProviderRequestPolicy(input, env).attributionHeaders;
}
export function resolveProviderRequestCapabilities(input, env = process.env) {
    const policy = resolveProviderRequestPolicy(input, env);
    const provider = policy.provider;
    const api = normalizeOptionalLowercaseString(input.api);
    const normalizedModelId = normalizeOptionalLowercaseString(input.modelId);
    const endpointClass = policy.endpointClass;
    const isKnownNativeEndpoint = endpointClass === "anthropic-public" ||
        endpointClass === "cerebras-native" ||
        endpointClass === "chutes-native" ||
        endpointClass === "deepseek-native" ||
        endpointClass === "github-copilot-native" ||
        endpointClass === "groq-native" ||
        endpointClass === "mistral-public" ||
        endpointClass === "moonshot-native" ||
        endpointClass === "modelstudio-native" ||
        endpointClass === "openai-public" ||
        endpointClass === "openai-codex" ||
        endpointClass === "opencode-native" ||
        endpointClass === "azure-openai" ||
        endpointClass === "openrouter" ||
        endpointClass === "xai-native" ||
        endpointClass === "zai-native" ||
        endpointClass === "google-generative-ai" ||
        endpointClass === "google-vertex";
    let compatibilityFamily;
    if (provider && MOONSHOT_COMPAT_PROVIDERS.has(provider)) {
        compatibilityFamily = "moonshot";
    }
    else if (provider === "ollama" &&
        normalizedModelId?.startsWith("kimi-k") &&
        normalizedModelId.includes(":cloud")) {
        compatibilityFamily = "moonshot";
    }
    return {
        ...policy,
        isKnownNativeEndpoint,
        allowsOpenAIServiceTier: (provider === "openai" && api === "openai-responses" && endpointClass === "openai-public") ||
            (provider === "openai-codex" &&
                (api === "openai-codex-responses" || api === "openai-responses") &&
                endpointClass === "openai-codex"),
        supportsOpenAIReasoningCompatPayload: provider !== undefined &&
            api !== undefined &&
            !policy.usesExplicitProxyLikeEndpoint &&
            (provider === "openai" ||
                provider === "openai-codex" ||
                provider === "azure-openai" ||
                provider === "azure-openai-responses") &&
            (api === "openai-completions" ||
                api === "openai-responses" ||
                api === "openai-codex-responses" ||
                api === "azure-openai-responses"),
        allowsAnthropicServiceTier: provider === "anthropic" &&
            api === "anthropic-messages" &&
            (endpointClass === "default" || endpointClass === "anthropic-public"),
        // This is intentionally the gate for emitting `store: false` on Responses
        // transports, not just a statement about vendor support in the abstract.
        supportsResponsesStoreField: input.compat?.supportsStore !== false && api !== undefined && OPENAI_RESPONSES_APIS.has(api),
        allowsResponsesStore: input.compat?.supportsStore !== false &&
            provider !== undefined &&
            api !== undefined &&
            OPENAI_RESPONSES_APIS.has(api) &&
            OPENAI_RESPONSES_PROVIDERS.has(provider) &&
            policy.usesKnownNativeOpenAIEndpoint,
        shouldStripResponsesPromptCache: api !== undefined && OPENAI_RESPONSES_APIS.has(api) && policy.usesExplicitProxyLikeEndpoint,
        // Native endpoint class is the real signal here. Users can point a generic
        // provider key at Moonshot or DashScope and still need streaming usage.
        supportsNativeStreamingUsageCompat: endpointClass === "moonshot-native" || endpointClass === "modelstudio-native",
        compatibilityFamily,
    };
}
