import { isRecord } from "../utils.js";
import { mergeProviders, mergeWithExistingProviderSecrets, } from "./models-config.merge.js";
import { resolveImplicitProviders } from "./models-config.providers.implicit.js";
import { normalizeProviders } from "./models-config.providers.normalize.js";
import { applyNativeStreamingUsageCompat } from "./models-config.providers.policy.js";
import { enforceSourceManagedProviderSecrets } from "./models-config.providers.source-managed.js";
async function resolveProvidersForModelsJson(params) {
    const { cfg, agentDir, env } = params;
    const explicitProviders = cfg.models?.providers ?? {};
    const implicitProviders = await resolveImplicitProviders({
        agentDir,
        config: cfg,
        env,
        explicitProviders,
    });
    return mergeProviders({
        implicit: implicitProviders,
        explicit: explicitProviders,
    });
}
function resolveExplicitBaseUrlProviders(providers) {
    return new Set(Object.entries(providers?.providers ?? {})
        .map(([key, provider]) => [key.trim(), provider])
        .filter(([key, provider]) => Boolean(key) && typeof provider?.baseUrl === "string" && provider.baseUrl.trim())
        .map(([key]) => key));
}
function resolveProvidersForMode(params) {
    if (params.mode !== "merge") {
        return params.providers;
    }
    const existing = params.existingParsed;
    if (!isRecord(existing) || !isRecord(existing.providers)) {
        return params.providers;
    }
    const existingProviders = existing.providers;
    return mergeWithExistingProviderSecrets({
        nextProviders: params.providers,
        existingProviders: existingProviders,
        secretRefManagedProviders: params.secretRefManagedProviders,
        explicitBaseUrlProviders: params.explicitBaseUrlProviders,
    });
}
export async function planOpenClawModelsJson(params) {
    const { cfg, agentDir, env } = params;
    const providers = await resolveProvidersForModelsJson({ cfg, agentDir, env });
    if (Object.keys(providers).length === 0) {
        return { action: "skip" };
    }
    const mode = cfg.models?.mode ?? "merge";
    const secretRefManagedProviders = new Set();
    const normalizedProviders = normalizeProviders({
        providers,
        agentDir,
        env,
        secretDefaults: cfg.secrets?.defaults,
        sourceProviders: params.sourceConfigForSecrets?.models?.providers,
        sourceSecretDefaults: params.sourceConfigForSecrets?.secrets?.defaults,
        secretRefManagedProviders,
    }) ?? providers;
    const mergedProviders = resolveProvidersForMode({
        mode,
        existingParsed: params.existingParsed,
        providers: normalizedProviders,
        secretRefManagedProviders,
        explicitBaseUrlProviders: resolveExplicitBaseUrlProviders(cfg.models),
    });
    const secretEnforcedProviders = enforceSourceManagedProviderSecrets({
        providers: mergedProviders,
        sourceProviders: params.sourceConfigForSecrets?.models?.providers,
        sourceSecretDefaults: params.sourceConfigForSecrets?.secrets?.defaults,
        secretRefManagedProviders,
    }) ?? mergedProviders;
    const finalProviders = applyNativeStreamingUsageCompat(secretEnforcedProviders);
    const nextContents = `${JSON.stringify({ providers: finalProviders }, null, 2)}\n`;
    if (params.existingRaw === nextContents) {
        return { action: "noop" };
    }
    return {
        action: "write",
        contents: nextContents,
    };
}
