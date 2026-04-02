export function createEmptyPluginRegistry() {
    return {
        plugins: [],
        tools: [],
        hooks: [],
        typedHooks: [],
        channels: [],
        channelSetups: [],
        providers: [],
        cliBackends: [],
        speechProviders: [],
        mediaUnderstandingProviders: [],
        imageGenerationProviders: [],
        webSearchProviders: [],
        gatewayHandlers: {},
        gatewayMethodScopes: {},
        httpRoutes: [],
        cliRegistrars: [],
        services: [],
        commands: [],
        conversationBindingResolvedHandlers: [],
        diagnostics: [],
    };
}
