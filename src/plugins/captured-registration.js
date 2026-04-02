import { buildPluginApi } from "./api-builder.js";
export function createCapturedPluginRegistration() {
    const providers = [];
    const cliBackends = [];
    const speechProviders = [];
    const mediaUnderstandingProviders = [];
    const imageGenerationProviders = [];
    const webSearchProviders = [];
    const tools = [];
    const noopLogger = {
        info() { },
        warn() { },
        error() { },
        debug() { },
    };
    return {
        providers,
        cliBackends,
        speechProviders,
        mediaUnderstandingProviders,
        imageGenerationProviders,
        webSearchProviders,
        tools,
        api: buildPluginApi({
            id: "captured-plugin-registration",
            name: "Captured Plugin Registration",
            source: "captured-plugin-registration",
            registrationMode: "full",
            config: {},
            runtime: {},
            logger: noopLogger,
            resolvePath: (input) => input,
            handlers: {
                registerProvider(provider) {
                    providers.push(provider);
                },
                registerCliBackend(backend) {
                    cliBackends.push(backend);
                },
                registerSpeechProvider(provider) {
                    speechProviders.push(provider);
                },
                registerMediaUnderstandingProvider(provider) {
                    mediaUnderstandingProviders.push(provider);
                },
                registerImageGenerationProvider(provider) {
                    imageGenerationProviders.push(provider);
                },
                registerWebSearchProvider(provider) {
                    webSearchProviders.push(provider);
                },
                registerTool(tool) {
                    if (typeof tool !== "function") {
                        tools.push(tool);
                    }
                },
            },
        }),
    };
}
export function capturePluginRegistration(params) {
    const captured = createCapturedPluginRegistration();
    params.register(captured.api);
    return captured;
}
