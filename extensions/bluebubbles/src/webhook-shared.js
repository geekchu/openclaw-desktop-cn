import { normalizeWebhookPath } from "openclaw/plugin-sdk/webhook-path";
export { normalizeWebhookPath };
export const DEFAULT_WEBHOOK_PATH = "/bluebubbles-webhook";
export function resolveWebhookPathFromConfig(config) {
    const raw = config?.webhookPath?.trim();
    if (raw) {
        return normalizeWebhookPath(raw);
    }
    return DEFAULT_WEBHOOK_PATH;
}
