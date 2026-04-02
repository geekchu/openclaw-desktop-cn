import { normalizeStringEntries } from "../shared/string-normalization.js";
import { projectSafeChannelAccountSnapshotFields } from "./account-snapshot-fields.js";
export function buildChannelAccountSnapshot(params) {
    const described = params.plugin.config.describeAccount?.(params.account, params.cfg);
    return {
        enabled: params.enabled,
        configured: params.configured,
        ...projectSafeChannelAccountSnapshotFields(params.account),
        ...described,
        accountId: params.accountId,
    };
}
export function formatChannelAllowFrom(params) {
    if (params.plugin.config.formatAllowFrom) {
        return params.plugin.config.formatAllowFrom({
            cfg: params.cfg,
            accountId: params.accountId,
            allowFrom: params.allowFrom,
        });
    }
    return normalizeStringEntries(params.allowFrom);
}
function asRecord(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    return value;
}
export function resolveChannelAccountEnabled(params) {
    if (params.plugin.config.isEnabled) {
        return params.plugin.config.isEnabled(params.account, params.cfg);
    }
    const enabled = asRecord(params.account)?.enabled;
    return enabled !== false;
}
export async function resolveChannelAccountConfigured(params) {
    if (params.plugin.config.isConfigured) {
        return await params.plugin.config.isConfigured(params.account, params.cfg);
    }
    if (params.readAccountConfiguredField) {
        const configured = asRecord(params.account)?.configured;
        return configured !== false;
    }
    return true;
}
