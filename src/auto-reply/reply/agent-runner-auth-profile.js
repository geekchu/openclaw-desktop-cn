export function resolveProviderScopedAuthProfile(params) {
    const authProfileId = params.provider === params.primaryProvider ? params.authProfileId : undefined;
    return {
        authProfileId,
        authProfileIdSource: authProfileId ? params.authProfileIdSource : undefined,
    };
}
export function resolveRunAuthProfile(run, provider) {
    return resolveProviderScopedAuthProfile({
        provider,
        primaryProvider: run.provider,
        authProfileId: run.authProfileId,
        authProfileIdSource: run.authProfileIdSource,
    });
}
