export { isRecord } from "../channels/plugins/status-issues/shared.js";
export { appendMatchMetadata, asString, collectIssuesForEnabledAccounts, formatMatchMetadata, resolveEnabledConfiguredAccountId, } from "../channels/plugins/status-issues/shared.js";
/** Create the baseline runtime snapshot shape used by channel/account status stores. */
export function createDefaultChannelRuntimeState(accountId, extra) {
    return {
        accountId,
        running: false,
        lastStartAt: null,
        lastStopAt: null,
        lastError: null,
        ...(extra ?? {}),
    };
}
/** Normalize a channel-level status summary so missing lifecycle fields become explicit nulls. */
export function buildBaseChannelStatusSummary(snapshot, extra) {
    return {
        configured: snapshot.configured ?? false,
        ...(extra ?? {}),
        running: snapshot.running ?? false,
        lastStartAt: snapshot.lastStartAt ?? null,
        lastStopAt: snapshot.lastStopAt ?? null,
        lastError: snapshot.lastError ?? null,
    };
}
/** Extend the base summary with probe fields while preserving stable null defaults. */
export function buildProbeChannelStatusSummary(snapshot, extra) {
    return {
        ...buildBaseChannelStatusSummary(snapshot, extra),
        probe: snapshot.probe,
        lastProbeAt: snapshot.lastProbeAt ?? null,
    };
}
/** Build webhook channel summaries with a stable default mode. */
export function buildWebhookChannelStatusSummary(snapshot, extra) {
    return buildBaseChannelStatusSummary(snapshot, {
        mode: snapshot.mode ?? "webhook",
        ...(extra ?? {}),
    });
}
/** Build the standard per-account status payload from config metadata plus runtime state. */
export function buildBaseAccountStatusSnapshot(params, extra) {
    const { account, runtime, probe } = params;
    return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        ...buildRuntimeAccountStatusSnapshot({ runtime, probe }),
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        ...(extra ?? {}),
    };
}
/** Convenience wrapper when the caller already has flattened account fields instead of an account object. */
export function buildComputedAccountStatusSnapshot(params, extra) {
    const { accountId, name, enabled, configured, runtime, probe } = params;
    return buildBaseAccountStatusSnapshot({
        account: {
            accountId,
            name,
            enabled,
            configured,
        },
        runtime,
        probe,
    }, extra);
}
/** Build a full status adapter when only configured/extras vary per account. */
export function createComputedAccountStatusAdapter(options) {
    return {
        defaultRuntime: options.defaultRuntime,
        buildChannelSummary: options.buildChannelSummary,
        probeAccount: options.probeAccount,
        formatCapabilitiesProbe: options.formatCapabilitiesProbe,
        auditAccount: options.auditAccount,
        buildCapabilitiesDiagnostics: options.buildCapabilitiesDiagnostics,
        logSelfId: options.logSelfId,
        resolveAccountState: options.resolveAccountState,
        collectStatusIssues: options.collectStatusIssues,
        buildAccountSnapshot: (params) => {
            const typedParams = params;
            const { extra, ...snapshot } = options.resolveAccountSnapshot(typedParams);
            return buildComputedAccountStatusSnapshot({
                ...snapshot,
                runtime: typedParams.runtime,
                probe: typedParams.probe,
            }, extra);
        },
    };
}
/** Async variant for channels that compute configured state or snapshot extras from I/O. */
export function createAsyncComputedAccountStatusAdapter(options) {
    return {
        defaultRuntime: options.defaultRuntime,
        buildChannelSummary: options.buildChannelSummary,
        probeAccount: options.probeAccount,
        formatCapabilitiesProbe: options.formatCapabilitiesProbe,
        auditAccount: options.auditAccount,
        buildCapabilitiesDiagnostics: options.buildCapabilitiesDiagnostics,
        logSelfId: options.logSelfId,
        resolveAccountState: options.resolveAccountState,
        collectStatusIssues: options.collectStatusIssues,
        buildAccountSnapshot: async (params) => {
            const typedParams = params;
            const { extra, ...snapshot } = await options.resolveAccountSnapshot(typedParams);
            return buildComputedAccountStatusSnapshot({
                ...snapshot,
                runtime: typedParams.runtime,
                probe: typedParams.probe,
            }, extra);
        },
    };
}
/** Normalize runtime-only account state into the shared status snapshot fields. */
export function buildRuntimeAccountStatusSnapshot(params, extra) {
    const { runtime, probe } = params;
    return {
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
        ...(extra ?? {}),
    };
}
/** Build token-based channel status summaries with optional mode reporting. */
export function buildTokenChannelStatusSummary(snapshot, opts) {
    const base = {
        ...buildBaseChannelStatusSummary(snapshot),
        tokenSource: snapshot.tokenSource ?? "none",
        probe: snapshot.probe,
        lastProbeAt: snapshot.lastProbeAt ?? null,
    };
    if (opts?.includeMode === false) {
        return base;
    }
    return {
        ...base,
        mode: snapshot.mode ?? null,
    };
}
/** Build a config-issue collector from snapshot-safe source metadata only. */
export function createDependentCredentialStatusIssueCollector(options) {
    const isDependencyConfigured = options.isDependencyConfigured ??
        ((value) => typeof value === "string" && value.trim().length > 0 && value !== "none");
    return (accounts) => accounts.flatMap((account) => {
        if (account.configured !== false) {
            return [];
        }
        return [
            {
                channel: options.channel,
                accountId: account.accountId ?? "",
                kind: "config",
                message: isDependencyConfigured(account[options.dependencySourceKey])
                    ? options.missingDependentMessage
                    : options.missingPrimaryMessage,
            },
        ];
    });
}
/** Convert account runtime errors into the generic channel status issue format. */
export function collectStatusIssuesFromLastError(channel, accounts) {
    return accounts.flatMap((account) => {
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) {
            return [];
        }
        return [
            {
                channel,
                accountId: account.accountId,
                kind: "runtime",
                message: `Channel error: ${lastError}`,
            },
        ];
    });
}
