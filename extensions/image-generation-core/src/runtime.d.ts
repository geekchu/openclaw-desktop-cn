import { type AuthProfileStore, type FallbackAttempt, type GeneratedImageAsset, type ImageGenerationResolution, type ImageGenerationSourceImage, type OpenClawConfig } from "../api.js";
export type GenerateImageParams = {
    cfg: OpenClawConfig;
    prompt: string;
    agentDir?: string;
    authStore?: AuthProfileStore;
    modelOverride?: string;
    count?: number;
    size?: string;
    aspectRatio?: string;
    resolution?: ImageGenerationResolution;
    inputImages?: ImageGenerationSourceImage[];
};
export type GenerateImageRuntimeResult = {
    images: GeneratedImageAsset[];
    provider: string;
    model: string;
    attempts: FallbackAttempt[];
    metadata?: Record<string, unknown>;
};
export declare function listRuntimeImageGenerationProviders(params?: {
    config?: OpenClawConfig;
}): any;
export declare function generateImage(params: GenerateImageParams): Promise<GenerateImageRuntimeResult>;
