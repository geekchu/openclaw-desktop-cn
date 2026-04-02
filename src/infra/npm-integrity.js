export async function resolveNpmIntegrityDrift(params) {
    if (!params.expectedIntegrity || !params.resolution.integrity) {
        return { proceed: true };
    }
    if (params.expectedIntegrity === params.resolution.integrity) {
        return { proceed: true };
    }
    const integrityDrift = {
        expectedIntegrity: params.expectedIntegrity,
        actualIntegrity: params.resolution.integrity,
    };
    const payload = params.createPayload({
        spec: params.spec,
        expectedIntegrity: integrityDrift.expectedIntegrity,
        actualIntegrity: integrityDrift.actualIntegrity,
        resolution: params.resolution,
    });
    let proceed = true;
    if (params.onIntegrityDrift) {
        proceed = await params.onIntegrityDrift(payload);
    }
    else {
        params.warn?.(payload);
    }
    return { integrityDrift, proceed, payload };
}
export async function resolveNpmIntegrityDriftWithDefaultMessage(params) {
    const driftResult = await resolveNpmIntegrityDrift({
        spec: params.spec,
        expectedIntegrity: params.expectedIntegrity,
        resolution: params.resolution,
        createPayload: (drift) => ({ ...drift }),
        onIntegrityDrift: params.onIntegrityDrift,
        warn: (driftPayload) => {
            params.warn?.(`Integrity drift detected for ${driftPayload.resolution.resolvedSpec ?? driftPayload.spec}: expected ${driftPayload.expectedIntegrity}, got ${driftPayload.actualIntegrity}`);
        },
    });
    if (!driftResult.proceed && driftResult.payload) {
        return {
            integrityDrift: driftResult.integrityDrift,
            error: `aborted: npm package integrity drift detected for ${driftResult.payload.resolution.resolvedSpec ?? driftResult.payload.spec}`,
        };
    }
    return { integrityDrift: driftResult.integrityDrift };
}
