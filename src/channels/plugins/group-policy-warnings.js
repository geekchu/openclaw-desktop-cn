import { resolveAllowlistProviderRuntimeGroupPolicy, resolveDefaultGroupPolicy, resolveOpenProviderRuntimeGroupPolicy, } from "../../config/runtime-group-policy.js";
export function composeWarningCollectors(...collectors) {
    return (params) => collectors.flatMap((collector) => collector?.(params) ?? []);
}
export function projectWarningCollector(project, collector) {
    return (params) => collector(project(params));
}
export function projectConfigWarningCollector(collector) {
    return projectWarningCollector((params) => ({ cfg: params.cfg }), collector);
}
export function projectConfigAccountIdWarningCollector(collector) {
    return projectWarningCollector((params) => ({ cfg: params.cfg, accountId: params.accountId }), collector);
}
export function projectAccountWarningCollector(collector) {
    return projectWarningCollector((params) => params.account, collector);
}
export function projectAccountConfigWarningCollector(projectCfg, collector) {
    return projectWarningCollector((params) => ({ account: params.account, cfg: projectCfg(params.cfg) }), collector);
}
export function createConditionalWarningCollector(...collectors) {
    return (params) => collectors.flatMap((collector) => {
        const next = collector(params);
        if (!next) {
            return [];
        }
        return Array.isArray(next) ? next : [next];
    });
}
export function composeAccountWarningCollectors(baseCollector, ...collectors) {
    return composeWarningCollectors(baseCollector, createConditionalWarningCollector(...collectors.map((collector) => ({ account }) => collector(account))));
}
export function buildOpenGroupPolicyWarning(params) {
    return `- ${params.surface}: groupPolicy="open" ${params.openBehavior}. ${params.remediation}.`;
}
export function buildOpenGroupPolicyRestrictSendersWarning(params) {
    const mentionSuffix = params.mentionGated === false ? "" : " (mention-gated)";
    return buildOpenGroupPolicyWarning({
        surface: params.surface,
        openBehavior: `allows ${params.openScope} to trigger${mentionSuffix}`,
        remediation: `Set ${params.groupPolicyPath}="allowlist" + ${params.groupAllowFromPath} to restrict senders`,
    });
}
export function buildOpenGroupPolicyNoRouteAllowlistWarning(params) {
    const mentionSuffix = params.mentionGated === false ? "" : " (mention-gated)";
    return buildOpenGroupPolicyWarning({
        surface: params.surface,
        openBehavior: `with no ${params.routeAllowlistPath} allowlist; any ${params.routeScope} can add + ping${mentionSuffix}`,
        remediation: `Set ${params.groupPolicyPath}="allowlist" + ${params.groupAllowFromPath} or configure ${params.routeAllowlistPath}`,
    });
}
export function buildOpenGroupPolicyConfigureRouteAllowlistWarning(params) {
    const mentionSuffix = params.mentionGated === false ? "" : " (mention-gated)";
    return buildOpenGroupPolicyWarning({
        surface: params.surface,
        openBehavior: `allows ${params.openScope} to trigger${mentionSuffix}`,
        remediation: `Set ${params.groupPolicyPath}="allowlist" and configure ${params.routeAllowlistPath}`,
    });
}
export function collectOpenGroupPolicyRestrictSendersWarnings(params) {
    if (params.groupPolicy !== "open") {
        return [];
    }
    return [buildOpenGroupPolicyRestrictSendersWarning(params)];
}
export function collectAllowlistProviderRestrictSendersWarnings(params) {
    return collectAllowlistProviderGroupPolicyWarnings({
        cfg: params.cfg,
        providerConfigPresent: params.providerConfigPresent,
        configuredGroupPolicy: params.configuredGroupPolicy,
        collect: (groupPolicy) => collectOpenGroupPolicyRestrictSendersWarnings({
            groupPolicy,
            surface: params.surface,
            openScope: params.openScope,
            groupPolicyPath: params.groupPolicyPath,
            groupAllowFromPath: params.groupAllowFromPath,
            mentionGated: params.mentionGated,
        }),
    });
}
/** Build an account-aware allowlist-provider warning collector for sender-restricted groups. */
export function createAllowlistProviderRestrictSendersWarningCollector(params) {
    return createAllowlistProviderGroupPolicyWarningCollector({
        providerConfigPresent: params.providerConfigPresent,
        resolveGroupPolicy: ({ account }) => params.resolveGroupPolicy(account),
        collect: ({ groupPolicy }) => collectOpenGroupPolicyRestrictSendersWarnings({
            groupPolicy,
            surface: params.surface,
            openScope: params.openScope,
            groupPolicyPath: params.groupPolicyPath,
            groupAllowFromPath: params.groupAllowFromPath,
            mentionGated: params.mentionGated,
        }),
    });
}
/** Build a direct account-aware warning collector when the policy already lives on the account. */
export function createOpenGroupPolicyRestrictSendersWarningCollector(params) {
    return (account) => collectOpenGroupPolicyRestrictSendersWarnings({
        groupPolicy: params.resolveGroupPolicy(account) ?? params.defaultGroupPolicy ?? "allowlist",
        surface: params.surface,
        openScope: params.openScope,
        groupPolicyPath: params.groupPolicyPath,
        groupAllowFromPath: params.groupAllowFromPath,
        mentionGated: params.mentionGated,
    });
}
export function collectAllowlistProviderGroupPolicyWarnings(params) {
    const defaultGroupPolicy = resolveDefaultGroupPolicy(params.cfg);
    const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: params.providerConfigPresent,
        groupPolicy: params.configuredGroupPolicy ?? undefined,
        defaultGroupPolicy,
    });
    return params.collect(groupPolicy);
}
/** Build a config-aware allowlist-provider warning collector from an arbitrary policy resolver. */
export function createAllowlistProviderGroupPolicyWarningCollector(params) {
    return (runtime) => collectAllowlistProviderGroupPolicyWarnings({
        cfg: runtime.cfg,
        providerConfigPresent: params.providerConfigPresent(runtime.cfg),
        configuredGroupPolicy: params.resolveGroupPolicy(runtime),
        collect: (groupPolicy) => params.collect({ ...runtime, groupPolicy }),
    });
}
export function collectOpenProviderGroupPolicyWarnings(params) {
    const defaultGroupPolicy = resolveDefaultGroupPolicy(params.cfg);
    const { groupPolicy } = resolveOpenProviderRuntimeGroupPolicy({
        providerConfigPresent: params.providerConfigPresent,
        groupPolicy: params.configuredGroupPolicy ?? undefined,
        defaultGroupPolicy,
    });
    return params.collect(groupPolicy);
}
/** Build a config-aware open-provider warning collector from an arbitrary policy resolver. */
export function createOpenProviderGroupPolicyWarningCollector(params) {
    return (runtime) => collectOpenProviderGroupPolicyWarnings({
        cfg: runtime.cfg,
        providerConfigPresent: params.providerConfigPresent(runtime.cfg),
        configuredGroupPolicy: params.resolveGroupPolicy(runtime),
        collect: (groupPolicy) => params.collect({ ...runtime, groupPolicy }),
    });
}
/** Build an account-aware allowlist-provider warning collector for simple open-policy warnings. */
export function createAllowlistProviderOpenWarningCollector(params) {
    return createAllowlistProviderGroupPolicyWarningCollector({
        providerConfigPresent: params.providerConfigPresent,
        resolveGroupPolicy: ({ account }) => params.resolveGroupPolicy(account),
        collect: ({ groupPolicy }) => groupPolicy === "open" ? [buildOpenGroupPolicyWarning(params.buildOpenWarning)] : [],
    });
}
export function collectOpenGroupPolicyRouteAllowlistWarnings(params) {
    if (params.groupPolicy !== "open") {
        return [];
    }
    if (params.routeAllowlistConfigured) {
        return [buildOpenGroupPolicyRestrictSendersWarning(params.restrictSenders)];
    }
    return [buildOpenGroupPolicyNoRouteAllowlistWarning(params.noRouteAllowlist)];
}
/** Build an account-aware allowlist-provider warning collector for route-allowlisted groups. */
export function createAllowlistProviderRouteAllowlistWarningCollector(params) {
    return createAllowlistProviderGroupPolicyWarningCollector({
        providerConfigPresent: params.providerConfigPresent,
        resolveGroupPolicy: ({ account }) => params.resolveGroupPolicy(account),
        collect: ({ account, groupPolicy }) => collectOpenGroupPolicyRouteAllowlistWarnings({
            groupPolicy,
            routeAllowlistConfigured: params.resolveRouteAllowlistConfigured(account),
            restrictSenders: params.restrictSenders,
            noRouteAllowlist: params.noRouteAllowlist,
        }),
    });
}
export function collectOpenGroupPolicyConfiguredRouteWarnings(params) {
    if (params.groupPolicy !== "open") {
        return [];
    }
    if (params.routeAllowlistConfigured) {
        return [buildOpenGroupPolicyConfigureRouteAllowlistWarning(params.configureRouteAllowlist)];
    }
    return [buildOpenGroupPolicyWarning(params.missingRouteAllowlist)];
}
/** Build an account-aware open-provider warning collector for configured-route channels. */
export function createOpenProviderConfiguredRouteWarningCollector(params) {
    return createOpenProviderGroupPolicyWarningCollector({
        providerConfigPresent: params.providerConfigPresent,
        resolveGroupPolicy: ({ account }) => params.resolveGroupPolicy(account),
        collect: ({ account, groupPolicy }) => collectOpenGroupPolicyConfiguredRouteWarnings({
            groupPolicy,
            routeAllowlistConfigured: params.resolveRouteAllowlistConfigured(account),
            configureRouteAllowlist: params.configureRouteAllowlist,
            missingRouteAllowlist: params.missingRouteAllowlist,
        }),
    });
}
