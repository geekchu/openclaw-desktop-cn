import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { KeyedAsyncQueue } from "openclaw/plugin-sdk/keyed-async-queue";
import { MAX_IMAGE_BYTES } from "../../media/constants.js";
import { buildTtsSystemPromptHint } from "../../tts/tts.js";
import { buildModelAliasLines } from "../model-alias-lines.js";
import { resolveDefaultModelForAgent } from "../model-selection.js";
import { resolveOwnerDisplaySetting } from "../owner-display.js";
import { detectImageReferences, loadImageFromRef } from "../pi-embedded-runner/run/images.js";
import { detectRuntimeShell } from "../shell-utils.js";
import { buildSystemPromptParams } from "../system-prompt-params.js";
import { buildAgentSystemPrompt } from "../system-prompt.js";
import { sanitizeImageBlocks } from "../tool-images.js";
export { buildCliSupervisorScopeKey, resolveCliNoOutputTimeoutMs } from "./reliability.js";
const CLI_RUN_QUEUE = new KeyedAsyncQueue();
export function enqueueCliRun(key, task) {
    return CLI_RUN_QUEUE.enqueue(key, task);
}
export function buildSystemPrompt(params) {
    const defaultModelRef = resolveDefaultModelForAgent({
        cfg: params.config ?? {},
        agentId: params.agentId,
    });
    const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;
    const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
        config: params.config,
        agentId: params.agentId,
        workspaceDir: params.workspaceDir,
        cwd: process.cwd(),
        runtime: {
            host: "openclaw",
            os: `${os.type()} ${os.release()}`,
            arch: os.arch(),
            node: process.version,
            model: params.modelDisplay,
            defaultModel: defaultModelLabel,
            shell: detectRuntimeShell(),
        },
    });
    const ttsHint = params.config ? buildTtsSystemPromptHint(params.config) : undefined;
    const ownerDisplay = resolveOwnerDisplaySetting(params.config);
    return buildAgentSystemPrompt({
        workspaceDir: params.workspaceDir,
        defaultThinkLevel: params.defaultThinkLevel,
        extraSystemPrompt: params.extraSystemPrompt,
        ownerNumbers: params.ownerNumbers,
        ownerDisplay: ownerDisplay.ownerDisplay,
        ownerDisplaySecret: ownerDisplay.ownerDisplaySecret,
        reasoningTagHint: false,
        heartbeatPrompt: params.heartbeatPrompt,
        docsPath: params.docsPath,
        acpEnabled: params.config?.acp?.enabled !== false,
        runtimeInfo,
        toolNames: params.tools.map((tool) => tool.name),
        modelAliasLines: buildModelAliasLines(params.config),
        userTimezone,
        userTime,
        userTimeFormat,
        contextFiles: params.contextFiles,
        ttsHint,
        memoryCitationsMode: params.config?.memory?.citations,
    });
}
export function normalizeCliModel(modelId, backend) {
    const trimmed = modelId.trim();
    if (!trimmed) {
        return trimmed;
    }
    const direct = backend.modelAliases?.[trimmed];
    if (direct) {
        return direct;
    }
    const lower = trimmed.toLowerCase();
    const mapped = backend.modelAliases?.[lower];
    if (mapped) {
        return mapped;
    }
    return trimmed;
}
export function resolveSystemPromptUsage(params) {
    const systemPrompt = params.systemPrompt?.trim();
    if (!systemPrompt) {
        return null;
    }
    const when = params.backend.systemPromptWhen ?? "first";
    if (when === "never") {
        return null;
    }
    if (when === "first" && !params.isNewSession) {
        return null;
    }
    if (!params.backend.systemPromptArg?.trim()) {
        return null;
    }
    return systemPrompt;
}
export function resolveSessionIdToSend(params) {
    const mode = params.backend.sessionMode ?? "always";
    const existing = params.cliSessionId?.trim();
    if (mode === "none") {
        return { sessionId: undefined, isNew: !existing };
    }
    if (mode === "existing") {
        return { sessionId: existing, isNew: !existing };
    }
    if (existing) {
        return { sessionId: existing, isNew: false };
    }
    return { sessionId: crypto.randomUUID(), isNew: true };
}
export function resolvePromptInput(params) {
    const inputMode = params.backend.input ?? "arg";
    if (inputMode === "stdin") {
        return { stdin: params.prompt };
    }
    if (params.backend.maxPromptArgChars && params.prompt.length > params.backend.maxPromptArgChars) {
        return { stdin: params.prompt };
    }
    return { argsPrompt: params.prompt };
}
function resolveImageExtension(mimeType) {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes("png")) {
        return "png";
    }
    if (normalized.includes("jpeg") || normalized.includes("jpg")) {
        return "jpg";
    }
    if (normalized.includes("gif")) {
        return "gif";
    }
    if (normalized.includes("webp")) {
        return "webp";
    }
    return "bin";
}
export function appendImagePathsToPrompt(prompt, paths) {
    if (!paths.length) {
        return prompt;
    }
    const trimmed = prompt.trimEnd();
    const separator = trimmed ? "\n\n" : "";
    return `${trimmed}${separator}${paths.join("\n")}`;
}
export async function loadPromptRefImages(params) {
    const refs = detectImageReferences(params.prompt);
    if (refs.length === 0) {
        return [];
    }
    const maxBytes = params.maxBytes ?? MAX_IMAGE_BYTES;
    const seen = new Set();
    const images = [];
    for (const ref of refs) {
        const key = `${ref.type}:${ref.resolved}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const image = await loadImageFromRef(ref, params.workspaceDir, {
            maxBytes,
            workspaceOnly: params.workspaceOnly,
            sandbox: params.sandbox,
        });
        if (image) {
            images.push(image);
        }
    }
    const { images: sanitizedImages } = await sanitizeImageBlocks(images, "prompt:images", {
        maxBytes,
    });
    return sanitizedImages;
}
export async function writeCliImages(images) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cli-images-"));
    const paths = [];
    for (let i = 0; i < images.length; i += 1) {
        const image = images[i];
        const ext = resolveImageExtension(image.mimeType);
        const filePath = path.join(tempDir, `image-${i + 1}.${ext}`);
        const buffer = Buffer.from(image.data, "base64");
        await fs.writeFile(filePath, buffer, { mode: 0o600 });
        paths.push(filePath);
    }
    const cleanup = async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    };
    return { paths, cleanup };
}
export function buildCliArgs(params) {
    const args = [...params.baseArgs];
    if (params.backend.modelArg && params.modelId) {
        args.push(params.backend.modelArg, params.modelId);
    }
    if (!params.useResume && params.systemPrompt && params.backend.systemPromptArg) {
        args.push(params.backend.systemPromptArg, params.systemPrompt);
    }
    if (!params.useResume && params.sessionId) {
        if (params.backend.sessionArgs && params.backend.sessionArgs.length > 0) {
            for (const entry of params.backend.sessionArgs) {
                args.push(entry.replaceAll("{sessionId}", params.sessionId));
            }
        }
        else if (params.backend.sessionArg) {
            args.push(params.backend.sessionArg, params.sessionId);
        }
    }
    if (params.imagePaths && params.imagePaths.length > 0) {
        const mode = params.backend.imageMode ?? "repeat";
        const imageArg = params.backend.imageArg;
        if (imageArg) {
            if (mode === "list") {
                args.push(imageArg, params.imagePaths.join(","));
            }
            else {
                for (const imagePath of params.imagePaths) {
                    args.push(imageArg, imagePath);
                }
            }
        }
    }
    if (params.promptArg !== undefined) {
        args.push(params.promptArg);
    }
    return args;
}
