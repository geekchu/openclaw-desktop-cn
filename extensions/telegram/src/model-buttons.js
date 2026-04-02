/**
 * Telegram inline button utilities for model selection.
 *
 * Callback data patterns (max 64 bytes for Telegram):
 * - mdl_prov              - show providers list
 * - mdl_list_{prov}_{pg}  - show models for provider (page N, 1-indexed)
 * - mdl_sel_{provider/id} - select model (standard)
 * - mdl_sel/{model}       - select model (compact fallback when standard is >64 bytes)
 * - mdl_back              - back to providers list
 */
const MODELS_PAGE_SIZE = 8;
const MAX_CALLBACK_DATA_BYTES = 64;
const CALLBACK_PREFIX = {
    providers: "mdl_prov",
    back: "mdl_back",
    list: "mdl_list_",
    selectStandard: "mdl_sel_",
    selectCompact: "mdl_sel/",
};
/**
 * Parse a model callback_data string into a structured object.
 * Returns null if the data doesn't match a known pattern.
 */
export function parseModelCallbackData(data) {
    const trimmed = data.trim();
    if (!trimmed.startsWith("mdl_")) {
        return null;
    }
    if (trimmed === CALLBACK_PREFIX.providers || trimmed === CALLBACK_PREFIX.back) {
        return { type: trimmed === CALLBACK_PREFIX.providers ? "providers" : "back" };
    }
    // mdl_list_{provider}_{page}
    const listMatch = trimmed.match(/^mdl_list_([a-z0-9_-]+)_(\d+)$/i);
    if (listMatch) {
        const [, provider, pageStr] = listMatch;
        const page = Number.parseInt(pageStr ?? "1", 10);
        if (provider && Number.isFinite(page) && page >= 1) {
            return { type: "list", provider, page };
        }
    }
    // mdl_sel/{model} (compact fallback)
    const compactSelMatch = trimmed.match(/^mdl_sel\/(.+)$/);
    if (compactSelMatch) {
        const modelRef = compactSelMatch[1];
        if (modelRef) {
            return {
                type: "select",
                model: modelRef,
            };
        }
    }
    // mdl_sel_{provider/model}
    const selMatch = trimmed.match(/^mdl_sel_(.+)$/);
    if (selMatch) {
        const modelRef = selMatch[1];
        if (modelRef) {
            const slashIndex = modelRef.indexOf("/");
            if (slashIndex > 0 && slashIndex < modelRef.length - 1) {
                return {
                    type: "select",
                    provider: modelRef.slice(0, slashIndex),
                    model: modelRef.slice(slashIndex + 1),
                };
            }
        }
    }
    return null;
}
export function buildModelSelectionCallbackData(params) {
    const fullCallbackData = `${CALLBACK_PREFIX.selectStandard}${params.provider}/${params.model}`;
    if (Buffer.byteLength(fullCallbackData, "utf8") <= MAX_CALLBACK_DATA_BYTES) {
        return fullCallbackData;
    }
    const compactCallbackData = `${CALLBACK_PREFIX.selectCompact}${params.model}`;
    return Buffer.byteLength(compactCallbackData, "utf8") <= MAX_CALLBACK_DATA_BYTES
        ? compactCallbackData
        : null;
}
export function resolveModelSelection(params) {
    if (params.callback.provider) {
        return {
            kind: "resolved",
            provider: params.callback.provider,
            model: params.callback.model,
        };
    }
    const matchingProviders = params.providers.filter((id) => params.byProvider.get(id)?.has(params.callback.model));
    if (matchingProviders.length === 1) {
        return {
            kind: "resolved",
            provider: matchingProviders[0],
            model: params.callback.model,
        };
    }
    return {
        kind: "ambiguous",
        model: params.callback.model,
        matchingProviders,
    };
}
/**
 * Build provider selection keyboard with 2 providers per row.
 */
export function buildProviderKeyboard(providers) {
    if (providers.length === 0) {
        return [];
    }
    const rows = [];
    let currentRow = [];
    for (const provider of providers) {
        const button = {
            text: `${provider.id} (${provider.count})`,
            callback_data: `mdl_list_${provider.id}_1`,
        };
        currentRow.push(button);
        if (currentRow.length === 2) {
            rows.push(currentRow);
            currentRow = [];
        }
    }
    // Push any remaining button
    if (currentRow.length > 0) {
        rows.push(currentRow);
    }
    return rows;
}
/**
 * Build model list keyboard with pagination and back button.
 */
export function buildModelsKeyboard(params) {
    const { provider, models, currentModel, currentPage, totalPages, modelNames } = params;
    const pageSize = params.pageSize ?? MODELS_PAGE_SIZE;
    if (models.length === 0) {
        return [[{ text: "<< Back", callback_data: CALLBACK_PREFIX.back }]];
    }
    const rows = [];
    // Calculate page slice
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, models.length);
    const pageModels = models.slice(startIndex, endIndex);
    // Model buttons - one per row
    const currentModelId = currentModel?.includes("/")
        ? currentModel.split("/").slice(1).join("/")
        : currentModel;
    for (const model of pageModels) {
        const callbackData = buildModelSelectionCallbackData({ provider, model });
        // Skip models that still exceed Telegram's callback_data limit.
        if (!callbackData) {
            continue;
        }
        const isCurrentModel = model === currentModelId;
        const displayLabel = modelNames?.get(`${provider}/${model}`) ?? model;
        const displayText = truncateModelId(displayLabel, 38);
        const text = isCurrentModel ? `${displayText} ✓` : displayText;
        rows.push([
            {
                text,
                callback_data: callbackData,
            },
        ]);
    }
    // Pagination row
    if (totalPages > 1) {
        const paginationRow = [];
        if (currentPage > 1) {
            paginationRow.push({
                text: "◀ Prev",
                callback_data: `${CALLBACK_PREFIX.list}${provider}_${currentPage - 1}`,
            });
        }
        paginationRow.push({
            text: `${currentPage}/${totalPages}`,
            callback_data: `${CALLBACK_PREFIX.list}${provider}_${currentPage}`, // noop
        });
        if (currentPage < totalPages) {
            paginationRow.push({
                text: "Next ▶",
                callback_data: `${CALLBACK_PREFIX.list}${provider}_${currentPage + 1}`,
            });
        }
        rows.push(paginationRow);
    }
    // Back button
    rows.push([{ text: "<< Back", callback_data: CALLBACK_PREFIX.back }]);
    return rows;
}
/**
 * Build "Browse providers" button for /model summary.
 */
export function buildBrowseProvidersButton() {
    return [[{ text: "Browse providers", callback_data: CALLBACK_PREFIX.providers }]];
}
/**
 * Truncate model ID for display, preserving end if too long.
 */
function truncateModelId(modelId, maxLen) {
    if (modelId.length <= maxLen) {
        return modelId;
    }
    // Show last part with ellipsis prefix
    return `…${modelId.slice(-(maxLen - 1))}`;
}
/**
 * Get page size for model list pagination.
 */
export function getModelsPageSize() {
    return MODELS_PAGE_SIZE;
}
/**
 * Calculate total pages for a model list.
 */
export function calculateTotalPages(totalModels, pageSize) {
    const size = pageSize ?? MODELS_PAGE_SIZE;
    return size > 0 ? Math.ceil(totalModels / size) : 1;
}
