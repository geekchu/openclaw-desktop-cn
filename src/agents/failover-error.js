import { readErrorName } from "../infra/errors.js";
import { classifyFailoverReason, classifyFailoverReasonFromHttpStatus, isTimeoutErrorMessage, } from "./pi-embedded-helpers.js";
const ABORT_TIMEOUT_RE = /request was aborted|request aborted/i;
export class FailoverError extends Error {
    reason;
    provider;
    model;
    profileId;
    status;
    code;
    constructor(message, params) {
        super(message, { cause: params.cause });
        this.name = "FailoverError";
        this.reason = params.reason;
        this.provider = params.provider;
        this.model = params.model;
        this.profileId = params.profileId;
        this.status = params.status;
        this.code = params.code;
    }
}
export function isFailoverError(err) {
    return err instanceof FailoverError;
}
export function resolveFailoverStatus(reason) {
    switch (reason) {
        case "billing":
            return 402;
        case "rate_limit":
            return 429;
        case "overloaded":
            return 503;
        case "auth":
            return 401;
        case "auth_permanent":
            return 403;
        case "timeout":
            return 408;
        case "format":
            return 400;
        case "model_not_found":
            return 404;
        case "session_expired":
            return 410; // Gone - session no longer exists
        default:
            return undefined;
    }
}
function findErrorProperty(err, reader, seen = new Set()) {
    const direct = reader(err);
    if (direct !== undefined) {
        return direct;
    }
    if (!err || typeof err !== "object") {
        return undefined;
    }
    if (seen.has(err)) {
        return undefined;
    }
    seen.add(err);
    const candidate = err;
    return (findErrorProperty(candidate.error, reader, seen) ??
        findErrorProperty(candidate.cause, reader, seen));
}
function readDirectStatusCode(err) {
    if (!err || typeof err !== "object") {
        return undefined;
    }
    const candidate = err.status ??
        err.statusCode;
    if (typeof candidate === "number") {
        return candidate;
    }
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
        return Number(candidate);
    }
    return undefined;
}
function getStatusCode(err) {
    return findErrorProperty(err, readDirectStatusCode);
}
function readDirectErrorCode(err) {
    if (!err || typeof err !== "object") {
        return undefined;
    }
    const directCode = err.code;
    if (typeof directCode === "string") {
        const trimmed = directCode.trim();
        return trimmed ? trimmed : undefined;
    }
    const status = err.status;
    if (typeof status !== "string" || /^\d+$/.test(status)) {
        return undefined;
    }
    const trimmed = status.trim();
    return trimmed ? trimmed : undefined;
}
function getErrorCode(err) {
    return findErrorProperty(err, readDirectErrorCode);
}
function readDirectErrorMessage(err) {
    if (err instanceof Error) {
        return err.message || undefined;
    }
    if (typeof err === "string") {
        return err || undefined;
    }
    if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
        return String(err);
    }
    if (typeof err === "symbol") {
        return err.description ?? undefined;
    }
    if (err && typeof err === "object") {
        const message = err.message;
        if (typeof message === "string") {
            return message || undefined;
        }
    }
    return undefined;
}
function getErrorMessage(err) {
    return findErrorProperty(err, readDirectErrorMessage) ?? "";
}
function getErrorCause(err) {
    if (!err || typeof err !== "object" || !("cause" in err)) {
        return undefined;
    }
    return err.cause;
}
/** Classify rate-limit / overloaded from symbolic error codes like RESOURCE_EXHAUSTED. */
function classifyFailoverReasonFromSymbolicCode(raw) {
    const normalized = raw?.trim().toUpperCase();
    if (!normalized) {
        return null;
    }
    switch (normalized) {
        case "RESOURCE_EXHAUSTED":
        case "RATE_LIMIT":
        case "RATE_LIMITED":
        case "RATE_LIMIT_EXCEEDED":
        case "TOO_MANY_REQUESTS":
        case "THROTTLED":
        case "THROTTLING":
        case "THROTTLINGEXCEPTION":
        case "THROTTLING_EXCEPTION":
            return "rate_limit";
        case "OVERLOADED":
        case "OVERLOADED_ERROR":
            return "overloaded";
        default:
            return null;
    }
}
function hasTimeoutHint(err) {
    if (!err) {
        return false;
    }
    if (readErrorName(err) === "TimeoutError") {
        return true;
    }
    const message = getErrorMessage(err);
    return Boolean(message && isTimeoutErrorMessage(message));
}
export function isTimeoutError(err) {
    if (hasTimeoutHint(err)) {
        return true;
    }
    if (!err || typeof err !== "object") {
        return false;
    }
    if (readErrorName(err) !== "AbortError") {
        return false;
    }
    const message = getErrorMessage(err);
    if (message && ABORT_TIMEOUT_RE.test(message)) {
        return true;
    }
    const cause = "cause" in err ? err.cause : undefined;
    const reason = "reason" in err ? err.reason : undefined;
    return hasTimeoutHint(cause) || hasTimeoutHint(reason);
}
export function resolveFailoverReasonFromError(err) {
    if (isFailoverError(err)) {
        return err.reason;
    }
    const status = getStatusCode(err);
    const message = getErrorMessage(err);
    const statusReason = classifyFailoverReasonFromHttpStatus(status, message);
    if (statusReason) {
        return statusReason;
    }
    // Check symbolic error codes (e.g. RESOURCE_EXHAUSTED from Google APIs)
    const symbolicCodeReason = classifyFailoverReasonFromSymbolicCode(getErrorCode(err));
    if (symbolicCodeReason) {
        return symbolicCodeReason;
    }
    const code = (getErrorCode(err) ?? "").toUpperCase();
    if ([
        "ETIMEDOUT",
        "ESOCKETTIMEDOUT",
        "ECONNRESET",
        "ECONNABORTED",
        "ECONNREFUSED",
        "ENETUNREACH",
        "EHOSTUNREACH",
        "EHOSTDOWN",
        "ENETRESET",
        "EPIPE",
        "EAI_AGAIN",
    ].includes(code)) {
        return "timeout";
    }
    // Walk into error cause chain *before* timeout heuristics so that a specific
    // cause (e.g. RESOURCE_EXHAUSTED wrapped in AbortError) overrides a parent
    // message-based "timeout" guess from isTimeoutError.
    const cause = getErrorCause(err);
    if (cause && cause !== err) {
        const causeReason = resolveFailoverReasonFromError(cause);
        if (causeReason) {
            return causeReason;
        }
    }
    if (isTimeoutError(err)) {
        return "timeout";
    }
    if (!message) {
        return null;
    }
    return classifyFailoverReason(message);
}
export function describeFailoverError(err) {
    if (isFailoverError(err)) {
        return {
            message: err.message,
            reason: err.reason,
            status: err.status,
            code: err.code,
        };
    }
    const message = getErrorMessage(err) || String(err);
    return {
        message,
        reason: resolveFailoverReasonFromError(err) ?? undefined,
        status: getStatusCode(err),
        code: getErrorCode(err),
    };
}
export function coerceToFailoverError(err, context) {
    if (isFailoverError(err)) {
        return err;
    }
    const reason = resolveFailoverReasonFromError(err);
    if (!reason) {
        return null;
    }
    const message = getErrorMessage(err) || String(err);
    const status = getStatusCode(err) ?? resolveFailoverStatus(reason);
    const code = getErrorCode(err);
    return new FailoverError(message, {
        reason,
        provider: context?.provider,
        model: context?.model,
        profileId: context?.profileId,
        status,
        code,
        cause: err instanceof Error ? err : undefined,
    });
}
