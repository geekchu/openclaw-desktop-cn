import { resolveStateDir } from "../../config/paths.js";
import { listRuntimeImageGenerationProviders, generateImage, } from "../../plugin-sdk/image-generation-runtime.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import { createLazyRuntimeMethod, createLazyRuntimeMethodBinder, createLazyRuntimeModule, } from "../../shared/lazy-runtime.js";
import { VERSION } from "../../version.js";
import { listWebSearchProviders, runWebSearch } from "../../web-search/runtime.js";
import { createRuntimeAgent } from "./runtime-agent.js";
import { defineCachedValue } from "./runtime-cache.js";
import { createRuntimeChannel } from "./runtime-channel.js";
import { createRuntimeConfig } from "./runtime-config.js";
import { createRuntimeEvents } from "./runtime-events.js";
import { createRuntimeLogging } from "./runtime-logging.js";
import { createRuntimeMedia } from "./runtime-media.js";
import { createRuntimeSystem } from "./runtime-system.js";
const loadTtsRuntime = createLazyRuntimeModule(() => import("./runtime-tts.runtime.js"));
const loadMediaUnderstandingRuntime = createLazyRuntimeModule(() => import("./runtime-media-understanding.runtime.js"));
const loadModelAuthRuntime = createLazyRuntimeModule(() => import("./runtime-model-auth.runtime.js"));
function createRuntimeTts() {
    const bindTtsRuntime = createLazyRuntimeMethodBinder(loadTtsRuntime);
    return {
        textToSpeech: bindTtsRuntime((runtime) => runtime.textToSpeech),
        textToSpeechTelephony: bindTtsRuntime((runtime) => runtime.textToSpeechTelephony),
        listVoices: bindTtsRuntime((runtime) => runtime.listSpeechVoices),
    };
}
function createRuntimeMediaUnderstandingFacade() {
    const bindMediaUnderstandingRuntime = createLazyRuntimeMethodBinder(loadMediaUnderstandingRuntime);
    return {
        runFile: bindMediaUnderstandingRuntime((runtime) => runtime.runMediaUnderstandingFile),
        describeImageFile: bindMediaUnderstandingRuntime((runtime) => runtime.describeImageFile),
        describeImageFileWithModel: bindMediaUnderstandingRuntime((runtime) => runtime.describeImageFileWithModel),
        describeVideoFile: bindMediaUnderstandingRuntime((runtime) => runtime.describeVideoFile),
        transcribeAudioFile: bindMediaUnderstandingRuntime((runtime) => runtime.transcribeAudioFile),
    };
}
function createRuntimeModelAuth() {
    const getApiKeyForModel = createLazyRuntimeMethod(loadModelAuthRuntime, (runtime) => runtime.getApiKeyForModel);
    const resolveApiKeyForProvider = createLazyRuntimeMethod(loadModelAuthRuntime, (runtime) => runtime.resolveApiKeyForProvider);
    return {
        getApiKeyForModel: (params) => getApiKeyForModel({
            model: params.model,
            cfg: params.cfg,
        }),
        resolveApiKeyForProvider: (params) => resolveApiKeyForProvider({
            provider: params.provider,
            cfg: params.cfg,
        }),
    };
}
function createUnavailableSubagentRuntime() {
    const unavailable = () => {
        throw new Error("Plugin runtime subagent methods are only available during a gateway request.");
    };
    return {
        run: unavailable,
        waitForRun: unavailable,
        getSessionMessages: unavailable,
        getSession: unavailable,
        deleteSession: unavailable,
    };
}
// ── Process-global gateway subagent runtime ─────────────────────────
// The gateway creates a real subagent runtime during startup, but gateway-owned
// plugin registries may be loaded (and cached) before the gateway path runs.
// A process-global holder lets explicitly gateway-bindable runtimes resolve the
// active gateway subagent dynamically without changing the default behavior for
// ordinary plugin runtimes.
const GATEWAY_SUBAGENT_SYMBOL = Symbol.for("openclaw.plugin.gatewaySubagentRuntime");
const gatewaySubagentState = resolveGlobalSingleton(GATEWAY_SUBAGENT_SYMBOL, () => ({
    subagent: undefined,
}));
/**
 * Set the process-global gateway subagent runtime.
 * Called during gateway startup so that gateway-bindable plugin runtimes can
 * resolve subagent methods dynamically even when their registry was cached
 * before the gateway finished loading plugins.
 */
export function setGatewaySubagentRuntime(subagent) {
    gatewaySubagentState.subagent = subagent;
}
/**
 * Reset the process-global gateway subagent runtime.
 * Used by tests to avoid leaking gateway state across module reloads.
 */
export function clearGatewaySubagentRuntime() {
    gatewaySubagentState.subagent = undefined;
}
/**
 * Create a late-binding subagent that resolves to:
 * 1. An explicitly provided subagent (from runtimeOptions), OR
 * 2. The process-global gateway subagent when the caller explicitly opts in, OR
 * 3. The unavailable fallback (throws with a clear error message).
 */
function createLateBindingSubagent(explicit, allowGatewaySubagentBinding = false) {
    if (explicit) {
        return explicit;
    }
    const unavailable = createUnavailableSubagentRuntime();
    if (!allowGatewaySubagentBinding) {
        return unavailable;
    }
    return new Proxy(unavailable, {
        get(_target, prop, _receiver) {
            const resolved = gatewaySubagentState.subagent ?? unavailable;
            return Reflect.get(resolved, prop, resolved);
        },
    });
}
export function createPluginRuntime(_options = {}) {
    const mediaUnderstanding = createRuntimeMediaUnderstandingFacade();
    const runtime = {
        // Sourced from the shared OpenClaw version resolver (#52899) so plugins
        // always see the same version the CLI reports, avoiding API-version drift.
        version: VERSION,
        config: createRuntimeConfig(),
        agent: createRuntimeAgent(),
        subagent: createLateBindingSubagent(_options.subagent, _options.allowGatewaySubagentBinding === true),
        system: createRuntimeSystem(),
        media: createRuntimeMedia(),
        imageGeneration: {
            generate: generateImage,
            listProviders: listRuntimeImageGenerationProviders,
        },
        webSearch: {
            listProviders: listWebSearchProviders,
            search: runWebSearch,
        },
        channel: createRuntimeChannel(),
        events: createRuntimeEvents(),
        logging: createRuntimeLogging(),
        state: { resolveStateDir },
    };
    defineCachedValue(runtime, "tts", createRuntimeTts);
    defineCachedValue(runtime, "mediaUnderstanding", () => mediaUnderstanding);
    defineCachedValue(runtime, "stt", () => ({
        transcribeAudioFile: mediaUnderstanding.transcribeAudioFile,
    }));
    defineCachedValue(runtime, "modelAuth", createRuntimeModelAuth);
    return runtime;
}
