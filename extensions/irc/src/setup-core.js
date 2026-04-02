import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { applyAccountNameToChannelSection, createSetupInputPresenceValidator, createTopLevelChannelAllowFromSetter, createTopLevelChannelDmPolicySetter, patchScopedAccountConfig, } from "openclaw/plugin-sdk/setup";
const channel = "irc";
const setIrcTopLevelDmPolicy = createTopLevelChannelDmPolicySetter({
    channel,
});
const setIrcTopLevelAllowFrom = createTopLevelChannelAllowFromSetter({
    channel,
});
export function parsePort(raw, fallback) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return fallback;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
        return fallback;
    }
    return parsed;
}
export function updateIrcAccountConfig(cfg, accountId, patch) {
    return patchScopedAccountConfig({
        cfg,
        channelKey: channel,
        accountId,
        patch,
        ensureChannelEnabled: false,
        ensureAccountEnabled: false,
    });
}
export function setIrcDmPolicy(cfg, dmPolicy) {
    return setIrcTopLevelDmPolicy(cfg, dmPolicy);
}
export function setIrcAllowFrom(cfg, allowFrom) {
    return setIrcTopLevelAllowFrom(cfg, allowFrom);
}
export function setIrcNickServ(cfg, accountId, nickserv) {
    return updateIrcAccountConfig(cfg, accountId, { nickserv });
}
export function setIrcGroupAccess(cfg, accountId, policy, entries, normalizeGroupEntry) {
    if (policy !== "allowlist") {
        return updateIrcAccountConfig(cfg, accountId, { enabled: true, groupPolicy: policy });
    }
    const normalizedEntries = [
        ...new Set(entries.map((entry) => normalizeGroupEntry(entry)).filter(Boolean)),
    ];
    const groups = Object.fromEntries(normalizedEntries.map((entry) => [entry, {}]));
    return updateIrcAccountConfig(cfg, accountId, {
        enabled: true,
        groupPolicy: "allowlist",
        groups,
    });
}
export const ircSetupAdapter = {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) => applyAccountNameToChannelSection({
        cfg,
        channelKey: channel,
        accountId,
        name,
    }),
    validateInput: createSetupInputPresenceValidator({
        whenNotUseEnv: [
            { someOf: ["host"], message: "IRC requires host." },
            { someOf: ["nick"], message: "IRC requires nick." },
        ],
    }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
        const setupInput = input;
        const namedConfig = applyAccountNameToChannelSection({
            cfg,
            channelKey: channel,
            accountId,
            name: setupInput.name,
        });
        const portInput = typeof setupInput.port === "number" ? String(setupInput.port) : String(setupInput.port ?? "");
        const patch = {
            enabled: true,
            host: setupInput.host?.trim(),
            port: portInput ? parsePort(portInput, setupInput.tls === false ? 6667 : 6697) : undefined,
            tls: setupInput.tls,
            nick: setupInput.nick?.trim(),
            username: setupInput.username?.trim(),
            realname: setupInput.realname?.trim(),
            password: setupInput.password?.trim(),
            channels: setupInput.channels,
        };
        return patchScopedAccountConfig({
            cfg: namedConfig,
            channelKey: channel,
            accountId,
            patch,
        });
    },
};
