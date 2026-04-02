import fs from "node:fs/promises";
import path from "node:path";
import { buildProviderRegistry, createMediaAttachmentCache, normalizeMediaAttachments, normalizeMediaProviderId, runCapability, } from "openclaw/plugin-sdk/media-runtime";
const KIND_BY_CAPABILITY = {
    audio: "audio.transcription",
    image: "image.description",
    video: "video.description",
};
function buildFileContext(params) {
    return {
        MediaPath: params.filePath,
        MediaType: params.mime,
    };
}
export async function runMediaUnderstandingFile(params) {
    const ctx = buildFileContext(params);
    const attachments = normalizeMediaAttachments(ctx);
    if (attachments.length === 0) {
        return { text: undefined };
    }
    const config = params.cfg.tools?.media?.[params.capability];
    if (config?.enabled === false) {
        // Avoid loading plugin-backed providers when the capability is disabled.
        return {
            text: undefined,
            provider: undefined,
            model: undefined,
            output: undefined,
        };
    }
    const providerRegistry = buildProviderRegistry(undefined, params.cfg);
    const cache = createMediaAttachmentCache(attachments, {
        localPathRoots: [path.dirname(params.filePath)],
    });
    try {
        const result = await runCapability({
            capability: params.capability,
            cfg: params.cfg,
            ctx,
            attachments: cache,
            media: attachments,
            agentDir: params.agentDir,
            providerRegistry,
            config,
            activeModel: params.activeModel,
        });
        const output = result.outputs.find((entry) => entry.kind === KIND_BY_CAPABILITY[params.capability]);
        const text = output?.text?.trim();
        return {
            text: text || undefined,
            provider: output?.provider,
            model: output?.model,
            output,
        };
    }
    finally {
        await cache.cleanup();
    }
}
export async function describeImageFile(params) {
    return await runMediaUnderstandingFile({ ...params, capability: "image" });
}
export async function describeImageFileWithModel(params) {
    const timeoutMs = params.timeoutMs ?? 30_000;
    const providerRegistry = buildProviderRegistry(undefined, params.cfg);
    const provider = providerRegistry.get(normalizeMediaProviderId(params.provider));
    if (!provider?.describeImage) {
        throw new Error(`Provider does not support image analysis: ${params.provider}`);
    }
    const buffer = await fs.readFile(params.filePath);
    return await provider.describeImage({
        buffer,
        fileName: path.basename(params.filePath),
        mime: params.mime,
        provider: params.provider,
        model: params.model,
        prompt: params.prompt,
        maxTokens: params.maxTokens,
        timeoutMs,
        cfg: params.cfg,
        agentDir: params.agentDir ?? "",
    });
}
export async function describeVideoFile(params) {
    return await runMediaUnderstandingFile({ ...params, capability: "video" });
}
export async function transcribeAudioFile(params) {
    const result = await runMediaUnderstandingFile({ ...params, capability: "audio" });
    return { text: result.text };
}
