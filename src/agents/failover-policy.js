export function shouldAllowCooldownProbeForReason(reason) {
    return (reason === "rate_limit" ||
        reason === "overloaded" ||
        reason === "billing" ||
        reason === "unknown");
}
export function shouldUseTransientCooldownProbeSlot(reason) {
    return reason === "rate_limit" || reason === "overloaded" || reason === "unknown";
}
export function shouldPreserveTransientCooldownProbeSlot(reason) {
    return (reason === "model_not_found" ||
        reason === "format" ||
        reason === "auth" ||
        reason === "auth_permanent" ||
        reason === "session_expired");
}
