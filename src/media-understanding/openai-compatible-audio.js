import path from "node:path";
import { assertOkOrThrowHttpError, normalizeBaseUrl, postTranscriptionRequest, requireTranscriptionText, } from "./shared.js";
function resolveModel(model, fallback) {
    const trimmed = model?.trim();
    return trimmed || fallback;
}
export async function transcribeOpenAiCompatibleAudio(params) {
    const fetchFn = params.fetchFn ?? fetch;
    const baseUrl = normalizeBaseUrl(params.baseUrl, params.defaultBaseUrl);
    const allowPrivate = Boolean(params.baseUrl?.trim());
    const url = `${baseUrl}/audio/transcriptions`;
    const model = resolveModel(params.model, params.defaultModel);
    const form = new FormData();
    const fileName = params.fileName?.trim() || path.basename(params.fileName) || "audio";
    const bytes = new Uint8Array(params.buffer);
    const blob = new Blob([bytes], {
        type: params.mime ?? "application/octet-stream",
    });
    form.append("file", blob, fileName);
    form.append("model", model);
    if (params.language?.trim()) {
        form.append("language", params.language.trim());
    }
    if (params.prompt?.trim()) {
        form.append("prompt", params.prompt.trim());
    }
    const headers = new Headers(params.headers);
    if (!headers.has("authorization")) {
        headers.set("authorization", `Bearer ${params.apiKey}`);
    }
    const { response: res, release } = await postTranscriptionRequest({
        url,
        headers,
        body: form,
        timeoutMs: params.timeoutMs,
        fetchFn,
        allowPrivateNetwork: allowPrivate,
    });
    try {
        await assertOkOrThrowHttpError(res, "Audio transcription failed");
        const payload = (await res.json());
        const text = requireTranscriptionText(payload.text, "Audio transcription response missing text");
        return { text, model };
    }
    finally {
        await release();
    }
}
