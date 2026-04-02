/**
 * Zalo Bot API client
 * @see https://bot.zaloplatforms.com/docs
 */
const ZALO_API_BASE = "https://bot-api.zaloplatforms.com";
export class ZaloApiError extends Error {
    errorCode;
    description;
    constructor(message, errorCode, description) {
        super(message);
        this.errorCode = errorCode;
        this.description = description;
        this.name = "ZaloApiError";
    }
    /** True if this is a long-polling timeout (no updates available) */
    get isPollingTimeout() {
        return this.errorCode === 408;
    }
}
/**
 * Call the Zalo Bot API
 */
export async function callZaloApi(method, token, body, options) {
    const url = `${ZALO_API_BASE}/bot${token}/${method}`;
    const controller = new AbortController();
    const timeoutId = options?.timeoutMs
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : undefined;
    const fetcher = options?.fetch ?? fetch;
    try {
        const response = await fetcher(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const data = (await response.json());
        if (!data.ok) {
            throw new ZaloApiError(data.description ?? `Zalo API error: ${method}`, data.error_code, data.description);
        }
        return data;
    }
    finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}
/**
 * Validate bot token and get bot info
 */
export async function getMe(token, timeoutMs, fetcher) {
    return callZaloApi("getMe", token, undefined, { timeoutMs, fetch: fetcher });
}
/**
 * Send a text message
 */
export async function sendMessage(token, params, fetcher) {
    return callZaloApi("sendMessage", token, params, { fetch: fetcher });
}
/**
 * Send a photo message
 */
export async function sendPhoto(token, params, fetcher) {
    return callZaloApi("sendPhoto", token, params, { fetch: fetcher });
}
/**
 * Send a temporary chat action such as typing.
 */
export async function sendChatAction(token, params, fetcher, timeoutMs) {
    return callZaloApi("sendChatAction", token, params, {
        timeoutMs,
        fetch: fetcher,
    });
}
/**
 * Get updates using long polling (dev/testing only)
 * Note: Zalo returns a single update per call, not an array like Telegram
 */
export async function getUpdates(token, params, fetcher) {
    const pollTimeoutSec = params?.timeout ?? 30;
    const timeoutMs = (pollTimeoutSec + 5) * 1000;
    const body = { timeout: String(pollTimeoutSec) };
    return callZaloApi("getUpdates", token, body, { timeoutMs, fetch: fetcher });
}
/**
 * Set webhook URL for receiving updates
 */
export async function setWebhook(token, params, fetcher) {
    return callZaloApi("setWebhook", token, params, { fetch: fetcher });
}
/**
 * Delete webhook configuration
 */
export async function deleteWebhook(token, fetcher, timeoutMs) {
    return callZaloApi("deleteWebhook", token, undefined, {
        timeoutMs,
        fetch: fetcher,
    });
}
/**
 * Get current webhook info
 */
export async function getWebhookInfo(token, fetcher) {
    return callZaloApi("getWebhookInfo", token, undefined, { fetch: fetcher });
}
