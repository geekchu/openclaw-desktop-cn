/**
 * Security module: token validation, rate limiting, input sanitization, user allowlist.
 */
import * as crypto from "node:crypto";
import { createFixedWindowRateLimiter, } from "openclaw/plugin-sdk/webhook-ingress";
/**
 * Validate webhook token using constant-time comparison.
 * Prevents timing attacks that could leak token bytes.
 */
export function validateToken(received, expected) {
    if (!received || !expected)
        return false;
    // Use HMAC to normalize lengths before comparison,
    // preventing timing side-channel on token length.
    const key = "openclaw-token-cmp";
    const a = crypto.createHmac("sha256", key).update(received).digest();
    const b = crypto.createHmac("sha256", key).update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}
/**
 * Check if a user ID is in the allowed list.
 * Allowlist mode must be explicit; empty lists should not match any user.
 */
export function checkUserAllowed(userId, allowedUserIds) {
    if (allowedUserIds.length === 0)
        return false;
    return allowedUserIds.includes(userId);
}
/**
 * Resolve DM authorization for a sender across all DM policy modes.
 * Keeps policy semantics in one place so webhook/startup behavior stays consistent.
 */
export function authorizeUserForDm(userId, dmPolicy, allowedUserIds) {
    if (dmPolicy === "disabled") {
        return { allowed: false, reason: "disabled" };
    }
    if (dmPolicy === "open") {
        return { allowed: true };
    }
    if (allowedUserIds.length === 0) {
        return { allowed: false, reason: "allowlist-empty" };
    }
    if (!checkUserAllowed(userId, allowedUserIds)) {
        return { allowed: false, reason: "not-allowlisted" };
    }
    return { allowed: true };
}
/**
 * Sanitize user input to prevent prompt injection attacks.
 * Filters known dangerous patterns and truncates long messages.
 */
export function sanitizeInput(text) {
    const dangerousPatterns = [
        /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/gi,
        /you\s+are\s+now\s+/gi,
        /system:\s*/gi,
        /<\|.*?\|>/g, // special tokens
    ];
    let sanitized = text;
    for (const pattern of dangerousPatterns) {
        sanitized = sanitized.replace(pattern, "[FILTERED]");
    }
    const maxLength = 4000;
    if (sanitized.length > maxLength) {
        sanitized = sanitized.slice(0, maxLength) + "... [truncated]";
    }
    return sanitized;
}
/**
 * Sliding window rate limiter per user ID.
 */
export class RateLimiter {
    limiter;
    limit;
    constructor(limit = 30, windowSeconds = 60, maxTrackedUsers = 5_000) {
        this.limit = limit;
        this.limiter = createFixedWindowRateLimiter({
            windowMs: Math.max(1, Math.floor(windowSeconds * 1000)),
            maxRequests: Math.max(1, Math.floor(limit)),
            maxTrackedKeys: Math.max(1, Math.floor(maxTrackedUsers)),
        });
    }
    /** Returns true if the request is allowed, false if rate-limited. */
    check(userId) {
        return !this.limiter.isRateLimited(userId);
    }
    /** Exposed for tests and diagnostics. */
    size() {
        return this.limiter.size();
    }
    /** Exposed for tests and account lifecycle cleanup. */
    clear() {
        this.limiter.clear();
    }
    /** Exposed for tests. */
    maxRequests() {
        return this.limit;
    }
}
