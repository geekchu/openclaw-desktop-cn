import { evaluateSenderGroupAccess, isNormalizedSenderAllowed, resolveOpenProviderRuntimeGroupPolicy, } from "./runtime-api.js";
const ZALO_ALLOW_FROM_PREFIX_RE = /^(zalo|zl):/i;
export function isZaloSenderAllowed(senderId, allowFrom) {
    return isNormalizedSenderAllowed({
        senderId,
        allowFrom,
        stripPrefixRe: ZALO_ALLOW_FROM_PREFIX_RE,
    });
}
export function resolveZaloRuntimeGroupPolicy(params) {
    return resolveOpenProviderRuntimeGroupPolicy({
        providerConfigPresent: params.providerConfigPresent,
        groupPolicy: params.groupPolicy,
        defaultGroupPolicy: params.defaultGroupPolicy,
    });
}
export function evaluateZaloGroupAccess(params) {
    return evaluateSenderGroupAccess({
        providerConfigPresent: params.providerConfigPresent,
        configuredGroupPolicy: params.configuredGroupPolicy,
        defaultGroupPolicy: params.defaultGroupPolicy,
        groupAllowFrom: params.groupAllowFrom,
        senderId: params.senderId,
        isSenderAllowed: isZaloSenderAllowed,
    });
}
