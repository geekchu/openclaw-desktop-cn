import { WebClient } from "@slack/web-api";
export const SLACK_DEFAULT_RETRY_OPTIONS = {
    retries: 2,
    factor: 2,
    minTimeout: 500,
    maxTimeout: 3000,
    randomize: true,
};
export const SLACK_WRITE_RETRY_OPTIONS = {
    retries: 0,
};
export function resolveSlackWebClientOptions(options = {}) {
    return {
        ...options,
        retryConfig: options.retryConfig ?? SLACK_DEFAULT_RETRY_OPTIONS,
    };
}
export function resolveSlackWriteClientOptions(options = {}) {
    return {
        ...options,
        retryConfig: options.retryConfig ?? SLACK_WRITE_RETRY_OPTIONS,
    };
}
export function createSlackWebClient(token, options = {}) {
    return new WebClient(token, resolveSlackWebClientOptions(options));
}
export function createSlackWriteClient(token, options = {}) {
    return new WebClient(token, resolveSlackWriteClientOptions(options));
}
