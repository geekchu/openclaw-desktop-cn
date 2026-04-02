import { appendLocalMediaParentRoots } from "../../media/local-roots.js";
import { getDefaultLocalRoots } from "../../media/web-media.js";
import { getApiKeyForModel, normalizeWorkspaceDir, requireApiKey } from "./tool-runtime.helpers.js";
export function applyImageModelConfigDefaults(cfg, imageModelConfig) {
    return applyAgentDefaultModelConfig(cfg, "imageModel", imageModelConfig);
}
export function applyImageGenerationModelConfigDefaults(cfg, imageGenerationModelConfig) {
    return applyAgentDefaultModelConfig(cfg, "imageGenerationModel", imageGenerationModelConfig);
}
function applyAgentDefaultModelConfig(cfg, key, modelConfig) {
    if (!cfg) {
        return undefined;
    }
    return {
        ...cfg,
        agents: {
            ...cfg.agents,
            defaults: {
                ...cfg.agents?.defaults,
                [key]: modelConfig,
            },
        },
    };
}
export function resolveMediaToolLocalRoots(workspaceDirRaw, options, mediaSources) {
    const workspaceDir = normalizeWorkspaceDir(workspaceDirRaw);
    if (options?.workspaceOnly) {
        return workspaceDir ? [workspaceDir] : [];
    }
    const roots = getDefaultLocalRoots();
    const scopedRoots = workspaceDir ? Array.from(new Set([...roots, workspaceDir])) : [...roots];
    return appendLocalMediaParentRoots(scopedRoots, mediaSources);
}
export function resolvePromptAndModelOverride(args, defaultPrompt) {
    const prompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : defaultPrompt;
    const modelOverride = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
    return { prompt, modelOverride };
}
export function buildTextToolResult(result, extraDetails) {
    return {
        content: [{ type: "text", text: result.text }],
        details: {
            model: `${result.provider}/${result.model}`,
            ...extraDetails,
            attempts: result.attempts,
        },
    };
}
export function resolveModelFromRegistry(params) {
    const model = params.modelRegistry.find(params.provider, params.modelId);
    if (!model) {
        throw new Error(`Unknown model: ${params.provider}/${params.modelId}`);
    }
    return model;
}
export async function resolveModelRuntimeApiKey(params) {
    const apiKeyInfo = await getApiKeyForModel({
        model: params.model,
        cfg: params.cfg,
        agentDir: params.agentDir,
    });
    const apiKey = requireApiKey(apiKeyInfo, params.model.provider);
    params.authStorage.setRuntimeApiKey(params.model.provider, apiKey);
    return apiKey;
}
