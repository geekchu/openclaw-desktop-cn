import { resolveOpenProviderRuntimeGroupPolicy } from "../config/runtime-group-policy.js";
/** Downgrade sender-scoped group policy to open mode when no allowlist is configured. */
export function resolveSenderScopedGroupPolicy(params) {
    if (params.groupPolicy === "disabled") {
        return "disabled";
    }
    return params.groupAllowFrom.length > 0 ? "allowlist" : "open";
}
/** Evaluate route-level group access after policy, route match, and enablement checks. */
export function evaluateGroupRouteAccessForPolicy(params) {
    if (params.groupPolicy === "disabled") {
        return {
            allowed: false,
            groupPolicy: params.groupPolicy,
            reason: "disabled",
        };
    }
    if (params.routeMatched && params.routeEnabled === false) {
        return {
            allowed: false,
            groupPolicy: params.groupPolicy,
            reason: "route_disabled",
        };
    }
    if (params.groupPolicy === "allowlist") {
        if (!params.routeAllowlistConfigured) {
            return {
                allowed: false,
                groupPolicy: params.groupPolicy,
                reason: "empty_allowlist",
            };
        }
        if (!params.routeMatched) {
            return {
                allowed: false,
                groupPolicy: params.groupPolicy,
                reason: "route_not_allowlisted",
            };
        }
    }
    return {
        allowed: true,
        groupPolicy: params.groupPolicy,
        reason: "allowed",
    };
}
/** Evaluate generic allowlist match state for channels that compare derived group identifiers. */
export function evaluateMatchedGroupAccessForPolicy(params) {
    if (params.groupPolicy === "disabled") {
        return {
            allowed: false,
            groupPolicy: params.groupPolicy,
            reason: "disabled",
        };
    }
    if (params.groupPolicy === "allowlist") {
        if (params.requireMatchInput && !params.hasMatchInput) {
            return {
                allowed: false,
                groupPolicy: params.groupPolicy,
                reason: "missing_match_input",
            };
        }
        if (!params.allowlistConfigured) {
            return {
                allowed: false,
                groupPolicy: params.groupPolicy,
                reason: "empty_allowlist",
            };
        }
        if (!params.allowlistMatched) {
            return {
                allowed: false,
                groupPolicy: params.groupPolicy,
                reason: "not_allowlisted",
            };
        }
    }
    return {
        allowed: true,
        groupPolicy: params.groupPolicy,
        reason: "allowed",
    };
}
/** Evaluate sender access for an already-resolved group policy and allowlist. */
export function evaluateSenderGroupAccessForPolicy(params) {
    if (params.groupPolicy === "disabled") {
        return {
            allowed: false,
            groupPolicy: params.groupPolicy,
            providerMissingFallbackApplied: Boolean(params.providerMissingFallbackApplied),
            reason: "disabled",
        };
    }
    if (params.groupPolicy === "allowlist") {
        if (params.groupAllowFrom.length === 0) {
            return {
                allowed: false,
                groupPolicy: params.groupPolicy,
                providerMissingFallbackApplied: Boolean(params.providerMissingFallbackApplied),
                reason: "empty_allowlist",
            };
        }
        if (!params.isSenderAllowed(params.senderId, params.groupAllowFrom)) {
            return {
                allowed: false,
                groupPolicy: params.groupPolicy,
                providerMissingFallbackApplied: Boolean(params.providerMissingFallbackApplied),
                reason: "sender_not_allowlisted",
            };
        }
    }
    return {
        allowed: true,
        groupPolicy: params.groupPolicy,
        providerMissingFallbackApplied: Boolean(params.providerMissingFallbackApplied),
        reason: "allowed",
    };
}
/** Resolve provider fallback policy first, then evaluate sender access against that result. */
export function evaluateSenderGroupAccess(params) {
    const { groupPolicy, providerMissingFallbackApplied } = resolveOpenProviderRuntimeGroupPolicy({
        providerConfigPresent: params.providerConfigPresent,
        groupPolicy: params.configuredGroupPolicy,
        defaultGroupPolicy: params.defaultGroupPolicy,
    });
    return evaluateSenderGroupAccessForPolicy({
        groupPolicy,
        providerMissingFallbackApplied,
        groupAllowFrom: params.groupAllowFrom,
        senderId: params.senderId,
        isSenderAllowed: params.isSenderAllowed,
    });
}
