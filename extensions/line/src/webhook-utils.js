export { validateLineSignature } from "./signature.js";
export function parseLineWebhookBody(rawBody) {
    try {
        return JSON.parse(rawBody);
    }
    catch {
        return null;
    }
}
