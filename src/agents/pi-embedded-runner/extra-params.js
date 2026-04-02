import { streamSimple } from "@mariozechner/pi-ai";
import { prepareProviderExtraParams as prepareProviderExtraParamsRuntime, wrapProviderStreamFn as wrapProviderStreamFnRuntime, } from "../../plugins/provider-runtime.js";
import { createAnthropicBetaHeadersWrapper, createAnthropicFastModeWrapper, createAnthropicToolPayloadCompatibilityWrapper, resolveAnthropicFastMode, resolveAnthropicBetas, resolveCacheRetention, } from "./anthropic-stream-wrappers.js";
import { createBedrockNoCacheWrapper, isAnthropicBedrockModel } from "./bedrock-stream-wrappers.js";
import { createGoogleThinkingPayloadWrapper } from "./google-stream-wrappers.js";
import { log } from "./logger.js";
import { createMinimaxFastModeWrapper } from "./minimax-stream-wrappers.js";
import { createMoonshotThinkingWrapper, resolveMoonshotThinkingType, createSiliconFlowThinkingWrapper, shouldApplyMoonshotPayloadCompat, shouldApplySiliconFlowThinkingOffCompat, } from "./moonshot-stream-wrappers.js";
import { createOpenAIAttributionHeadersWrapper, createOpenAIDefaultTransportWrapper, createOpenAIFastModeWrapper, createOpenAIResponsesContextManagementWrapper, createOpenAIServiceTierWrapper, resolveOpenAIFastMode, resolveOpenAIServiceTier, } from "./openai-stream-wrappers.js";
import { streamWithPayloadPatch } from "./stream-payload-utils.js";
const defaultProviderRuntimeDeps = {
    prepareProviderExtraParams: prepareProviderExtraParamsRuntime,
    wrapProviderStreamFn: wrapProviderStreamFnRuntime,
};
const providerRuntimeDeps = {
    ...defaultProviderRuntimeDeps,
};
export const __testing = {
    setProviderRuntimeDepsForTest(deps) {
        providerRuntimeDeps.prepareProviderExtraParams =
            deps?.prepareProviderExtraParams ?? defaultProviderRuntimeDeps.prepareProviderExtraParams;
        providerRuntimeDeps.wrapProviderStreamFn =
            deps?.wrapProviderStreamFn ?? defaultProviderRuntimeDeps.wrapProviderStreamFn;
    },
    resetProviderRuntimeDepsForTest() {
        providerRuntimeDeps.prepareProviderExtraParams =
            defaultProviderRuntimeDeps.prepareProviderExtraParams;
        providerRuntimeDeps.wrapProviderStreamFn = defaultProviderRuntimeDeps.wrapProviderStreamFn;
    },
};
/**
 * Resolve provider-specific extra params from model config.
 * Used to pass through stream params like temperature/maxTokens.
 *
 * @internal Exported for testing only
 */
export function resolveExtraParams(params) {
    const modelKey = `${params.provider}/${params.modelId}`;
    const modelConfig = params.cfg?.agents?.defaults?.models?.[modelKey];
    const globalParams = modelConfig?.params ? { ...modelConfig.params } : undefined;
    const agentParams = params.agentId && params.cfg?.agents?.list
        ? params.cfg.agents.list.find((agent) => agent.id === params.agentId)?.params
        : undefined;
    if (!globalParams && !agentParams) {
        return undefined;
    }
    const merged = Object.assign({}, globalParams, agentParams);
    const resolvedParallelToolCalls = resolveAliasedParamValue([globalParams, agentParams], "parallel_tool_calls", "parallelToolCalls");
    if (resolvedParallelToolCalls !== undefined) {
        merged.parallel_tool_calls = resolvedParallelToolCalls;
        delete merged.parallelToolCalls;
    }
    return merged;
}
function resolveSupportedTransport(value) {
    return value === "sse" || value === "websocket" || value === "auto" ? value : undefined;
}
function hasExplicitTransportSetting(settings) {
    return Object.hasOwn(settings, "transport");
}
export function resolvePreparedExtraParams(params) {
    const resolvedExtraParams = params.resolvedExtraParams ??
        resolveExtraParams({
            cfg: params.cfg,
            provider: params.provider,
            modelId: params.modelId,
            agentId: params.agentId,
        });
    const override = params.extraParamsOverride && Object.keys(params.extraParamsOverride).length > 0
        ? sanitizeExtraParamsRecord(Object.fromEntries(Object.entries(params.extraParamsOverride).filter(([, value]) => value !== undefined)))
        : undefined;
    const merged = {
        ...sanitizeExtraParamsRecord(resolvedExtraParams),
        ...override,
    };
    return (providerRuntimeDeps.prepareProviderExtraParams({
        provider: params.provider,
        config: params.cfg,
        context: {
            config: params.cfg,
            provider: params.provider,
            modelId: params.modelId,
            extraParams: merged,
            thinkingLevel: params.thinkingLevel,
        },
    }) ?? merged);
}
function sanitizeExtraParamsRecord(value) {
    if (!value) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "__proto__" && key !== "prototype" && key !== "constructor"));
}
export function resolveAgentTransportOverride(params) {
    const globalSettings = params.settingsManager.getGlobalSettings();
    const projectSettings = params.settingsManager.getProjectSettings();
    if (hasExplicitTransportSetting(globalSettings) || hasExplicitTransportSetting(projectSettings)) {
        return undefined;
    }
    return resolveSupportedTransport(params.effectiveExtraParams?.transport);
}
function createStreamFnWithExtraParams(baseStreamFn, extraParams, provider) {
    if (!extraParams || Object.keys(extraParams).length === 0) {
        return undefined;
    }
    const streamParams = {};
    if (typeof extraParams.temperature === "number") {
        streamParams.temperature = extraParams.temperature;
    }
    if (typeof extraParams.maxTokens === "number") {
        streamParams.maxTokens = extraParams.maxTokens;
    }
    const transport = resolveSupportedTransport(extraParams.transport);
    if (transport) {
        streamParams.transport = transport;
    }
    else if (extraParams.transport != null) {
        const transportSummary = typeof extraParams.transport === "string"
            ? extraParams.transport
            : typeof extraParams.transport;
        log.warn(`ignoring invalid transport param: ${transportSummary}`);
    }
    if (typeof extraParams.openaiWsWarmup === "boolean") {
        streamParams.openaiWsWarmup = extraParams.openaiWsWarmup;
    }
    const cacheRetention = resolveCacheRetention(extraParams, provider);
    if (cacheRetention) {
        streamParams.cacheRetention = cacheRetention;
    }
    if (Object.keys(streamParams).length === 0) {
        return undefined;
    }
    log.debug(`creating streamFn wrapper with params: ${JSON.stringify(streamParams)}`);
    const underlying = baseStreamFn ?? streamSimple;
    const wrappedStreamFn = (model, context, options) => {
        return underlying(model, context, {
            ...streamParams,
            ...options,
        });
    };
    return wrappedStreamFn;
}
function resolveAliasedParamValue(sources, snakeCaseKey, camelCaseKey) {
    let resolved = undefined;
    let seen = false;
    for (const source of sources) {
        if (!source) {
            continue;
        }
        const hasSnakeCaseKey = Object.hasOwn(source, snakeCaseKey);
        const hasCamelCaseKey = Object.hasOwn(source, camelCaseKey);
        if (!hasSnakeCaseKey && !hasCamelCaseKey) {
            continue;
        }
        resolved = hasSnakeCaseKey ? source[snakeCaseKey] : source[camelCaseKey];
        seen = true;
    }
    return seen ? resolved : undefined;
}
function createParallelToolCallsWrapper(baseStreamFn, enabled) {
    const underlying = baseStreamFn ?? streamSimple;
    return (model, context, options) => {
        if (model.api !== "openai-completions" && model.api !== "openai-responses") {
            return underlying(model, context, options);
        }
        log.debug(`applying parallel_tool_calls=${enabled} for ${model.provider ?? "unknown"}/${model.id ?? "unknown"} api=${model.api}`);
        return streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
            payloadObj.parallel_tool_calls = enabled;
        });
    };
}
function applyPrePluginStreamWrappers(ctx) {
    if (ctx.provider === "openai" || ctx.provider === "openai-codex") {
        if (ctx.provider === "openai") {
            // Default OpenAI Responses to WebSocket-first with transparent SSE fallback.
            ctx.agent.streamFn = createOpenAIDefaultTransportWrapper(ctx.agent.streamFn);
        }
        ctx.agent.streamFn = createOpenAIAttributionHeadersWrapper(ctx.agent.streamFn);
    }
    const wrappedStreamFn = createStreamFnWithExtraParams(ctx.agent.streamFn, ctx.effectiveExtraParams, ctx.provider);
    if (wrappedStreamFn) {
        log.debug(`applying extraParams to agent streamFn for ${ctx.provider}/${ctx.modelId}`);
        ctx.agent.streamFn = wrappedStreamFn;
    }
    const anthropicBetas = resolveAnthropicBetas(ctx.effectiveExtraParams, ctx.provider, ctx.modelId);
    if (anthropicBetas?.length) {
        log.debug(`applying Anthropic beta header for ${ctx.provider}/${ctx.modelId}: ${anthropicBetas.join(",")}`);
        ctx.agent.streamFn = createAnthropicBetaHeadersWrapper(ctx.agent.streamFn, anthropicBetas);
    }
    if (shouldApplySiliconFlowThinkingOffCompat({
        provider: ctx.provider,
        modelId: ctx.modelId,
        thinkingLevel: ctx.thinkingLevel,
    })) {
        log.debug(`normalizing thinking=off to thinking=null for SiliconFlow compatibility (${ctx.provider}/${ctx.modelId})`);
        ctx.agent.streamFn = createSiliconFlowThinkingWrapper(ctx.agent.streamFn);
    }
    ctx.agent.streamFn = createAnthropicToolPayloadCompatibilityWrapper(ctx.agent.streamFn, {
        config: ctx.cfg,
        workspaceDir: ctx.workspaceDir,
    });
}
function applyPostPluginStreamWrappers(ctx) {
    if (!ctx.providerWrapperHandled &&
        shouldApplyMoonshotPayloadCompat({ provider: ctx.provider, modelId: ctx.modelId })) {
        // Preserve the legacy Moonshot compatibility path when no plugin wrapper
        // actually handled the stream function. This mainly covers tests and
        // disabled plugins for the native Moonshot provider.
        const thinkingType = resolveMoonshotThinkingType({
            configuredThinking: ctx.effectiveExtraParams?.thinking,
            thinkingLevel: ctx.thinkingLevel,
        });
        ctx.agent.streamFn = createMoonshotThinkingWrapper(ctx.agent.streamFn, thinkingType);
    }
    if (ctx.provider === "amazon-bedrock" && !isAnthropicBedrockModel(ctx.modelId)) {
        log.debug(`disabling prompt caching for non-Anthropic Bedrock model ${ctx.provider}/${ctx.modelId}`);
        ctx.agent.streamFn = createBedrockNoCacheWrapper(ctx.agent.streamFn);
    }
    // Guard Google payloads against invalid negative thinking budgets emitted by
    // upstream model-ID heuristics for Gemini 3.1 variants.
    ctx.agent.streamFn = createGoogleThinkingPayloadWrapper(ctx.agent.streamFn, ctx.thinkingLevel);
    const anthropicFastMode = resolveAnthropicFastMode(ctx.effectiveExtraParams);
    if (anthropicFastMode !== undefined) {
        log.debug(`applying Anthropic fast mode=${anthropicFastMode} for ${ctx.provider}/${ctx.modelId}`);
        ctx.agent.streamFn = createAnthropicFastModeWrapper(ctx.agent.streamFn, anthropicFastMode);
    }
    if (typeof ctx.effectiveExtraParams?.fastMode === "boolean") {
        log.debug(`applying MiniMax fast mode=${ctx.effectiveExtraParams.fastMode} for ${ctx.provider}/${ctx.modelId}`);
        ctx.agent.streamFn = createMinimaxFastModeWrapper(ctx.agent.streamFn, ctx.effectiveExtraParams.fastMode);
    }
    const openAIFastMode = resolveOpenAIFastMode(ctx.effectiveExtraParams);
    if (openAIFastMode) {
        log.debug(`applying OpenAI fast mode for ${ctx.provider}/${ctx.modelId}`);
        ctx.agent.streamFn = createOpenAIFastModeWrapper(ctx.agent.streamFn);
    }
    const openAIServiceTier = resolveOpenAIServiceTier(ctx.effectiveExtraParams);
    if (openAIServiceTier) {
        log.debug(`applying OpenAI service_tier=${openAIServiceTier} for ${ctx.provider}/${ctx.modelId}`);
        ctx.agent.streamFn = createOpenAIServiceTierWrapper(ctx.agent.streamFn, openAIServiceTier);
    }
    // Work around upstream pi-ai hardcoding `store: false` for Responses API.
    // Force `store=true` for direct OpenAI Responses models and auto-enable
    // server-side compaction for compatible OpenAI Responses payloads.
    ctx.agent.streamFn = createOpenAIResponsesContextManagementWrapper(ctx.agent.streamFn, ctx.effectiveExtraParams);
    const rawParallelToolCalls = resolveAliasedParamValue([ctx.resolvedExtraParams, ctx.override], "parallel_tool_calls", "parallelToolCalls");
    if (rawParallelToolCalls === undefined) {
        return;
    }
    if (typeof rawParallelToolCalls === "boolean") {
        ctx.agent.streamFn = createParallelToolCallsWrapper(ctx.agent.streamFn, rawParallelToolCalls);
        return;
    }
    if (rawParallelToolCalls === null) {
        log.debug("parallel_tool_calls suppressed by null override, skipping injection");
        return;
    }
    const summary = typeof rawParallelToolCalls === "string" ? rawParallelToolCalls : typeof rawParallelToolCalls;
    log.warn(`ignoring invalid parallel_tool_calls param: ${summary}`);
}
/**
 * Apply extra params (like temperature) to an agent's streamFn.
 * Also applies verified provider-specific request wrappers, such as OpenRouter attribution.
 *
 * @internal Exported for testing
 */
export function applyExtraParamsToAgent(agent, cfg, provider, modelId, extraParamsOverride, thinkingLevel, agentId, workspaceDir, model) {
    const resolvedExtraParams = resolveExtraParams({
        cfg,
        provider,
        modelId,
        agentId,
    });
    const override = extraParamsOverride && Object.keys(extraParamsOverride).length > 0
        ? Object.fromEntries(Object.entries(extraParamsOverride).filter(([, value]) => value !== undefined))
        : undefined;
    const effectiveExtraParams = resolvePreparedExtraParams({
        cfg,
        provider,
        modelId,
        extraParamsOverride,
        thinkingLevel,
        agentId,
        resolvedExtraParams,
    });
    const wrapperContext = {
        agent,
        cfg,
        provider,
        modelId,
        workspaceDir,
        thinkingLevel,
        model,
        effectiveExtraParams,
        resolvedExtraParams,
        override,
    };
    applyPrePluginStreamWrappers(wrapperContext);
    const providerStreamBase = agent.streamFn;
    const pluginWrappedStreamFn = providerRuntimeDeps.wrapProviderStreamFn({
        provider,
        config: cfg,
        context: {
            config: cfg,
            provider,
            modelId,
            extraParams: effectiveExtraParams,
            thinkingLevel,
            model,
            streamFn: providerStreamBase,
        },
    });
    agent.streamFn = pluginWrappedStreamFn ?? providerStreamBase;
    const providerWrapperHandled = pluginWrappedStreamFn !== undefined && pluginWrappedStreamFn !== providerStreamBase;
    applyPostPluginStreamWrappers({
        ...wrapperContext,
        providerWrapperHandled,
    });
    return { effectiveExtraParams };
}
