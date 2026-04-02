import { resolveProviderStreamFn } from "../plugins/provider-runtime.js";
import { ensureCustomApiRegistered } from "./custom-api-registry.js";
export function registerProviderStreamForModel(params) {
    const streamFn = resolveProviderStreamFn({
        provider: params.model.provider,
        config: params.cfg,
        workspaceDir: params.workspaceDir,
        env: params.env,
        context: {
            config: params.cfg,
            agentDir: params.agentDir,
            workspaceDir: params.workspaceDir,
            provider: params.model.provider,
            modelId: params.model.id,
            model: params.model,
        },
    });
    if (!streamFn) {
        return undefined;
    }
    ensureCustomApiRegistered(params.model.api, streamFn);
    return streamFn;
}
