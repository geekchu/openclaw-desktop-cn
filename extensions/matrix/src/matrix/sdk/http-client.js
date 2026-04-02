import { buildHttpError } from "./event-helpers.js";
import { performMatrixRequest } from "./transport.js";
export class MatrixAuthedHttpClient {
    homeserver;
    accessToken;
    ssrfPolicy;
    constructor(homeserver, accessToken, ssrfPolicy) {
        this.homeserver = homeserver;
        this.accessToken = accessToken;
        this.ssrfPolicy = ssrfPolicy;
    }
    async requestJson(params) {
        const { response, text } = await performMatrixRequest({
            homeserver: this.homeserver,
            accessToken: this.accessToken,
            method: params.method,
            endpoint: params.endpoint,
            qs: params.qs,
            body: params.body,
            timeoutMs: params.timeoutMs,
            ssrfPolicy: this.ssrfPolicy,
            allowAbsoluteEndpoint: params.allowAbsoluteEndpoint,
        });
        if (!response.ok) {
            throw buildHttpError(response.status, text);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            if (!text.trim()) {
                return {};
            }
            return JSON.parse(text);
        }
        return text;
    }
    async requestRaw(params) {
        const { response, buffer } = await performMatrixRequest({
            homeserver: this.homeserver,
            accessToken: this.accessToken,
            method: params.method,
            endpoint: params.endpoint,
            qs: params.qs,
            timeoutMs: params.timeoutMs,
            raw: true,
            maxBytes: params.maxBytes,
            readIdleTimeoutMs: params.readIdleTimeoutMs,
            ssrfPolicy: this.ssrfPolicy,
            allowAbsoluteEndpoint: params.allowAbsoluteEndpoint,
        });
        if (!response.ok) {
            throw buildHttpError(response.status, buffer.toString("utf8"));
        }
        return buffer;
    }
}
