import { assertMediaNotDataUrl, resolveSandboxedMediaSource } from "../../agents/sandbox-paths.js";
import { readStringParam } from "../../agents/tools/common.js";
import { createRootScopedReadFile } from "../../infra/fs-safe.js";
import { basenameFromMediaSource } from "../../infra/local-file-access.js";
import { extensionForMime } from "../../media/mime.js";
import { loadWebMedia } from "../../media/web-media.js";
import { readBooleanParam as readBooleanParamShared } from "../../plugin-sdk/boolean-param.js";
export const readBooleanParam = readBooleanParamShared;
const SANDBOX_MEDIA_PARAM_KEYS = ["media", "path", "filePath", "mediaUrl", "fileUrl"];
function readMediaParam(args, key) {
    return readStringParam(args, key, { trim: false });
}
function readAttachmentMediaHint(args) {
    return readMediaParam(args, "media") ?? readMediaParam(args, "mediaUrl");
}
function readAttachmentFileHint(args) {
    return (readMediaParam(args, "path") ??
        readMediaParam(args, "filePath") ??
        readMediaParam(args, "fileUrl"));
}
function resolveAttachmentMaxBytes(params) {
    const accountId = typeof params.accountId === "string" ? params.accountId.trim() : "";
    const channelCfg = params.cfg.channels?.[params.channel];
    const channelObj = channelCfg && typeof channelCfg === "object"
        ? channelCfg
        : undefined;
    const channelMediaMax = typeof channelObj?.mediaMaxMb === "number" ? channelObj.mediaMaxMb : undefined;
    const accountsObj = channelObj?.accounts && typeof channelObj.accounts === "object"
        ? channelObj.accounts
        : undefined;
    const accountCfg = accountId && accountsObj ? accountsObj[accountId] : undefined;
    const accountMediaMax = accountCfg && typeof accountCfg === "object"
        ? accountCfg.mediaMaxMb
        : undefined;
    // Priority: account-specific > channel-level > global default
    const limitMb = (typeof accountMediaMax === "number" ? accountMediaMax : undefined) ??
        channelMediaMax ??
        params.cfg.agents?.defaults?.mediaMaxMb;
    return typeof limitMb === "number" ? limitMb * 1024 * 1024 : undefined;
}
function inferAttachmentFilename(params) {
    const mediaHint = params.mediaHint?.trim();
    if (mediaHint) {
        const base = basenameFromMediaSource(mediaHint);
        if (base) {
            return base;
        }
    }
    const ext = params.contentType ? extensionForMime(params.contentType) : undefined;
    return ext ? `attachment${ext}` : "attachment";
}
function normalizeBase64Payload(params) {
    if (!params.base64) {
        return { base64: params.base64, contentType: params.contentType };
    }
    const match = /^data:([^;]+);base64,(.*)$/i.exec(params.base64.trim());
    if (!match) {
        return { base64: params.base64, contentType: params.contentType };
    }
    const [, mime, payload] = match;
    return {
        base64: payload,
        contentType: params.contentType ?? mime,
    };
}
export function resolveAttachmentMediaPolicy(params) {
    const sandboxRoot = params.sandboxRoot?.trim();
    if (sandboxRoot) {
        return {
            mode: "sandbox",
            sandboxRoot,
        };
    }
    return {
        mode: "host",
        localRoots: params.mediaLocalRoots,
    };
}
function buildAttachmentMediaLoadOptions(params) {
    if (params.policy.mode === "sandbox") {
        const readSandboxFile = createRootScopedReadFile({
            rootDir: params.policy.sandboxRoot.trim(),
        });
        return {
            maxBytes: params.maxBytes,
            sandboxValidated: true,
            readFile: readSandboxFile,
        };
    }
    return {
        maxBytes: params.maxBytes,
        localRoots: params.policy.localRoots,
    };
}
async function hydrateAttachmentPayload(params) {
    const contentTypeParam = params.contentTypeParam ?? undefined;
    const rawBuffer = readStringParam(params.args, "buffer", { trim: false });
    const normalized = normalizeBase64Payload({
        base64: rawBuffer,
        contentType: contentTypeParam ?? undefined,
    });
    if (normalized.base64 !== rawBuffer && normalized.base64) {
        params.args.buffer = normalized.base64;
        if (normalized.contentType && !contentTypeParam) {
            params.args.contentType = normalized.contentType;
        }
    }
    const filename = readStringParam(params.args, "filename");
    const mediaSource = (params.mediaHint ?? undefined) || (params.fileHint ?? undefined);
    if (!params.dryRun && !readStringParam(params.args, "buffer", { trim: false }) && mediaSource) {
        const maxBytes = resolveAttachmentMaxBytes({
            cfg: params.cfg,
            channel: params.channel,
            accountId: params.accountId,
        });
        const media = await loadWebMedia(mediaSource, buildAttachmentMediaLoadOptions({ policy: params.mediaPolicy, maxBytes }));
        params.args.buffer = media.buffer.toString("base64");
        if (!contentTypeParam && media.contentType) {
            params.args.contentType = media.contentType;
        }
        if (!filename) {
            params.args.filename = inferAttachmentFilename({
                mediaHint: media.fileName ?? mediaSource,
                contentType: media.contentType ?? contentTypeParam ?? undefined,
            });
        }
    }
    else if (!filename) {
        params.args.filename = inferAttachmentFilename({
            mediaHint: mediaSource,
            contentType: contentTypeParam ?? undefined,
        });
    }
}
export async function normalizeSandboxMediaParams(params) {
    const sandboxRoot = params.mediaPolicy.mode === "sandbox" ? params.mediaPolicy.sandboxRoot.trim() : undefined;
    for (const key of SANDBOX_MEDIA_PARAM_KEYS) {
        const raw = readMediaParam(params.args, key);
        if (!raw) {
            continue;
        }
        assertMediaNotDataUrl(raw);
        if (!sandboxRoot) {
            continue;
        }
        const normalized = await resolveSandboxedMediaSource({ media: raw, sandboxRoot });
        if (normalized !== raw) {
            params.args[key] = normalized;
        }
    }
}
export async function normalizeSandboxMediaList(params) {
    const sandboxRoot = params.sandboxRoot?.trim();
    const normalized = [];
    const seen = new Set();
    for (const value of params.values) {
        const raw = value?.trim();
        if (!raw) {
            continue;
        }
        assertMediaNotDataUrl(raw);
        const resolved = sandboxRoot
            ? await resolveSandboxedMediaSource({ media: raw, sandboxRoot })
            : raw;
        if (seen.has(resolved)) {
            continue;
        }
        seen.add(resolved);
        normalized.push(resolved);
    }
    return normalized;
}
async function hydrateAttachmentActionPayload(params) {
    const mediaHint = readAttachmentMediaHint(params.args);
    const fileHint = readAttachmentFileHint(params.args);
    const contentTypeParam = readStringParam(params.args, "contentType") ?? readStringParam(params.args, "mimeType");
    if (params.allowMessageCaptionFallback) {
        const caption = readStringParam(params.args, "caption", { allowEmpty: true })?.trim();
        const message = readStringParam(params.args, "message", { allowEmpty: true })?.trim();
        if (!caption && message) {
            params.args.caption = message;
        }
    }
    await hydrateAttachmentPayload({
        cfg: params.cfg,
        channel: params.channel,
        accountId: params.accountId,
        args: params.args,
        dryRun: params.dryRun,
        contentTypeParam,
        mediaHint,
        fileHint,
        mediaPolicy: params.mediaPolicy,
    });
}
export async function hydrateAttachmentParamsForAction(params) {
    const shouldHydrateBlueBubblesUploadFile = params.action === "upload-file" && params.channel === "bluebubbles";
    if (params.action !== "sendAttachment" &&
        params.action !== "setGroupIcon" &&
        !shouldHydrateBlueBubblesUploadFile) {
        return;
    }
    await hydrateAttachmentActionPayload({
        cfg: params.cfg,
        channel: params.channel,
        accountId: params.accountId,
        args: params.args,
        dryRun: params.dryRun,
        mediaPolicy: params.mediaPolicy,
        allowMessageCaptionFallback: params.action === "sendAttachment" || shouldHydrateBlueBubblesUploadFile,
    });
}
export function parseButtonsParam(params) {
    const raw = params.buttons;
    if (typeof raw !== "string") {
        return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        delete params.buttons;
        return;
    }
    try {
        params.buttons = JSON.parse(trimmed);
    }
    catch {
        throw new Error("--buttons must be valid JSON");
    }
}
export function parseCardParam(params) {
    const raw = params.card;
    if (typeof raw !== "string") {
        return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        delete params.card;
        return;
    }
    try {
        params.card = JSON.parse(trimmed);
    }
    catch {
        throw new Error("--card must be valid JSON");
    }
}
export function parseComponentsParam(params) {
    const raw = params.components;
    if (typeof raw !== "string") {
        return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        delete params.components;
        return;
    }
    try {
        params.components = JSON.parse(trimmed);
    }
    catch {
        throw new Error("--components must be valid JSON");
    }
}
export function parseInteractiveParam(params) {
    const raw = params.interactive;
    if (typeof raw !== "string") {
        return;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        delete params.interactive;
        return;
    }
    try {
        params.interactive = JSON.parse(trimmed);
    }
    catch {
        throw new Error("--interactive must be valid JSON");
    }
}
