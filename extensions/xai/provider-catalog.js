import { buildXaiCatalogModels, XAI_BASE_URL } from "./model-definitions.js";
export function buildXaiProvider(api = "openai-responses") {
    return {
        baseUrl: XAI_BASE_URL,
        api,
        models: buildXaiCatalogModels(),
    };
}
