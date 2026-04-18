function createEmptyPluginRegistry() {
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
    realtimeTranscriptionProviders: [],
    realtimeVoiceProviders: [],
    mediaUnderstandingProviders: [],
    imageGenerationProviders: [],
    videoGenerationProviders: [],
    musicGenerationProviders: [],
    webFetchProviders: [],
    webSearchProviders: [],
    memoryEmbeddingProviders: [],
    gatewayHandlers: {},
    gatewayMethodScopes: {},
    httpRoutes: [],
    cliRegistrars: [],
    reloads: [],
    nodeHostCommands: [],
    securityAuditCollectors: [],
    services: [],
    commands: [],
    conversationBindingResolvedHandlers: [],
    diagnostics: []
  };
}
export {
  createEmptyPluginRegistry
};
