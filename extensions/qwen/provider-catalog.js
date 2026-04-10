import { buildQwenModelCatalogForBaseUrl, QWEN_BASE_URL } from "./models.js";
export function buildQwenProvider(params) {
    const baseUrl = params?.baseUrl ?? QWEN_BASE_URL;
    return {
        baseUrl,
        api: "openai-completions",
        models: buildQwenModelCatalogForBaseUrl(baseUrl).map((model) => ({ ...model })),
    };
}
export const buildModelStudioProvider = buildQwenProvider;
