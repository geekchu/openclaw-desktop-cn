import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { requiresExplicitMatrixDefaultAccount } from "./account-selection.js";
import { listMatrixDirectoryGroupsLive } from "./directory-live.js";
import { listMatrixAccountIds, resolveDefaultMatrixAccountId, resolveMatrixAccount, resolveMatrixAccountConfig, } from "./matrix/accounts.js";
import { resolveValidatedMatrixHomeserverUrl, validateMatrixHomeserverUrl, } from "./matrix/client.js";
import { resolveMatrixEnvAuthReadiness } from "./matrix/client/env-auth.js";
import { resolveMatrixConfigFieldPath, updateMatrixAccountConfig, } from "./matrix/config-update.js";
import { ensureMatrixSdkInstalled, isMatrixSdkAvailable } from "./matrix/deps.js";
import { resolveMatrixTargets } from "./resolve-targets.js";
import { addWildcardAllowFrom, formatDocsLink, hasConfiguredSecretInput, isPrivateOrLoopbackHost, mergeAllowFromEntries, moveSingleAccountChannelSectionToDefaultAccount, normalizeAccountId, promptChannelAccessConfig, promptAccountId, } from "./runtime-api.js";
const channel = "matrix";
function resolveMatrixOnboardingAccountId(cfg, accountId) {
    return normalizeAccountId(accountId?.trim() || resolveDefaultMatrixAccountId(cfg) || DEFAULT_ACCOUNT_ID);
}
function setMatrixDmPolicy(cfg, policy, accountId) {
    const resolvedAccountId = resolveMatrixOnboardingAccountId(cfg, accountId);
    const existing = resolveMatrixAccountConfig({
        cfg,
        accountId: resolvedAccountId,
    });
    const allowFrom = policy === "open" ? addWildcardAllowFrom(existing.dm?.allowFrom) : undefined;
    return updateMatrixAccountConfig(cfg, resolvedAccountId, {
        dm: {
            ...existing.dm,
            policy,
            ...(allowFrom ? { allowFrom } : {}),
        },
    });
}
async function noteMatrixAuthHelp(prompter) {
    await prompter.note([
        "Matrix requires a homeserver URL.",
        "Use an access token (recommended) or password login to an existing account.",
        "With access token: user ID is fetched automatically.",
        "Env vars supported: MATRIX_HOMESERVER, MATRIX_USER_ID, MATRIX_ACCESS_TOKEN, MATRIX_PASSWORD, MATRIX_DEVICE_ID, MATRIX_DEVICE_NAME.",
        "Per-account env vars: MATRIX_<ACCOUNT_ID>_HOMESERVER, MATRIX_<ACCOUNT_ID>_USER_ID, MATRIX_<ACCOUNT_ID>_ACCESS_TOKEN, MATRIX_<ACCOUNT_ID>_PASSWORD, MATRIX_<ACCOUNT_ID>_DEVICE_ID, MATRIX_<ACCOUNT_ID>_DEVICE_NAME.",
        `Docs: ${formatDocsLink("/channels/matrix", "channels/matrix")}`,
    ].join("\n"), "Matrix setup");
}
function requiresMatrixPrivateNetworkOptIn(homeserver) {
    try {
        const parsed = new URL(homeserver);
        return parsed.protocol === "http:" && !isPrivateOrLoopbackHost(parsed.hostname);
    }
    catch {
        return false;
    }
}
async function promptMatrixAllowFrom(params) {
    const { cfg, prompter } = params;
    const accountId = resolveMatrixOnboardingAccountId(cfg, params.accountId);
    const existingConfig = resolveMatrixAccountConfig({ cfg, accountId });
    const existingAllowFrom = existingConfig.dm?.allowFrom ?? [];
    const account = resolveMatrixAccount({ cfg, accountId });
    const canResolve = Boolean(account.configured);
    const parseInput = (raw) => raw
        .split(/[\n,;]+/g)
        .map((entry) => entry.trim())
        .filter(Boolean);
    const isFullUserId = (value) => value.startsWith("@") && value.includes(":");
    while (true) {
        const entry = await prompter.text({
            message: "Matrix allowFrom (full @user:server; display name only if unique)",
            placeholder: "@user:server",
            initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
            validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
        });
        const parts = parseInput(String(entry));
        const resolvedIds = [];
        const pending = [];
        const unresolved = [];
        const unresolvedNotes = [];
        for (const part of parts) {
            if (isFullUserId(part)) {
                resolvedIds.push(part);
                continue;
            }
            if (!canResolve) {
                unresolved.push(part);
                continue;
            }
            pending.push(part);
        }
        if (pending.length > 0) {
            const results = await resolveMatrixTargets({
                cfg,
                accountId,
                inputs: pending,
                kind: "user",
            }).catch(() => []);
            for (const result of results) {
                if (result?.resolved && result.id) {
                    resolvedIds.push(result.id);
                    continue;
                }
                if (result?.input) {
                    unresolved.push(result.input);
                    if (result.note) {
                        unresolvedNotes.push(`${result.input}: ${result.note}`);
                    }
                }
            }
        }
        if (unresolved.length > 0) {
            const details = unresolvedNotes.length > 0 ? unresolvedNotes : unresolved;
            await prompter.note(`Could not resolve:\n${details.join("\n")}\nUse full @user:server IDs.`, "Matrix allowlist");
            continue;
        }
        const unique = mergeAllowFromEntries(existingAllowFrom, resolvedIds);
        return updateMatrixAccountConfig(cfg, accountId, {
            dm: {
                ...existingConfig.dm,
                policy: "allowlist",
                allowFrom: unique,
            },
        });
    }
}
function setMatrixGroupPolicy(cfg, groupPolicy, accountId) {
    return updateMatrixAccountConfig(cfg, resolveMatrixOnboardingAccountId(cfg, accountId), {
        groupPolicy,
    });
}
function setMatrixGroupRooms(cfg, roomKeys, accountId) {
    const groups = Object.fromEntries(roomKeys.map((key) => [key, { allow: true }]));
    return updateMatrixAccountConfig(cfg, resolveMatrixOnboardingAccountId(cfg, accountId), {
        groups,
        rooms: null,
    });
}
const dmPolicy = {
    label: "Matrix",
    channel,
    policyKey: "channels.matrix.dm.policy",
    allowFromKey: "channels.matrix.dm.allowFrom",
    resolveConfigKeys: (cfg, accountId) => {
        const effectiveAccountId = resolveMatrixOnboardingAccountId(cfg, accountId);
        return {
            policyKey: resolveMatrixConfigFieldPath(cfg, effectiveAccountId, "dm.policy"),
            allowFromKey: resolveMatrixConfigFieldPath(cfg, effectiveAccountId, "dm.allowFrom"),
        };
    },
    getCurrent: (cfg, accountId) => resolveMatrixAccountConfig({
        cfg: cfg,
        accountId: resolveMatrixOnboardingAccountId(cfg, accountId),
    }).dm?.policy ?? "pairing",
    setPolicy: (cfg, policy, accountId) => setMatrixDmPolicy(cfg, policy, accountId),
    promptAllowFrom: promptMatrixAllowFrom,
};
async function runMatrixConfigure(params) {
    let next = params.cfg;
    await ensureMatrixSdkInstalled({
        runtime: params.runtime,
        confirm: async (message) => await params.prompter.confirm({
            message,
            initialValue: true,
        }),
    });
    const defaultAccountId = resolveDefaultMatrixAccountId(next);
    let accountId = defaultAccountId || DEFAULT_ACCOUNT_ID;
    if (params.intent === "add-account") {
        const enteredName = String(await params.prompter.text({
            message: "Matrix account name",
            validate: (value) => (value?.trim() ? undefined : "Required"),
        })).trim();
        accountId = normalizeAccountId(enteredName);
        if (enteredName !== accountId) {
            await params.prompter.note(`Account id will be "${accountId}".`, "Matrix account");
        }
        if (accountId !== DEFAULT_ACCOUNT_ID) {
            next = moveSingleAccountChannelSectionToDefaultAccount({
                cfg: next,
                channelKey: channel,
            });
        }
        next = updateMatrixAccountConfig(next, accountId, { name: enteredName, enabled: true });
    }
    else {
        const override = params.accountOverrides?.[channel]?.trim();
        if (override) {
            accountId = normalizeAccountId(override);
        }
        else if (params.shouldPromptAccountIds) {
            accountId = await promptAccountId({
                cfg: next,
                prompter: params.prompter,
                label: "Matrix",
                currentId: accountId,
                listAccountIds: (inputCfg) => listMatrixAccountIds(inputCfg),
                defaultAccountId,
            });
        }
    }
    const existing = resolveMatrixAccountConfig({ cfg: next, accountId });
    const account = resolveMatrixAccount({ cfg: next, accountId });
    if (!account.configured) {
        await noteMatrixAuthHelp(params.prompter);
    }
    const envReadiness = resolveMatrixEnvAuthReadiness(accountId, process.env);
    const envReady = envReadiness.ready;
    const envHomeserver = envReadiness.homeserver;
    const envUserId = envReadiness.userId;
    if (envReady &&
        !existing.homeserver &&
        !existing.userId &&
        !existing.accessToken &&
        !existing.password) {
        const useEnv = await params.prompter.confirm({
            message: `Matrix env vars detected (${envReadiness.sourceHint}). Use env values?`,
            initialValue: true,
        });
        if (useEnv) {
            next = updateMatrixAccountConfig(next, accountId, { enabled: true });
            if (params.forceAllowFrom) {
                next = await promptMatrixAllowFrom({
                    cfg: next,
                    prompter: params.prompter,
                    accountId,
                });
            }
            return { cfg: next, accountId };
        }
    }
    const homeserver = String(await params.prompter.text({
        message: "Matrix homeserver URL",
        initialValue: existing.homeserver ?? envHomeserver,
        validate: (value) => {
            try {
                validateMatrixHomeserverUrl(String(value ?? ""), {
                    allowPrivateNetwork: true,
                });
                return undefined;
            }
            catch (error) {
                return error instanceof Error ? error.message : "Invalid Matrix homeserver URL";
            }
        },
    })).trim();
    const requiresAllowPrivateNetwork = requiresMatrixPrivateNetworkOptIn(homeserver);
    const shouldPromptAllowPrivateNetwork = requiresAllowPrivateNetwork || existing.allowPrivateNetwork === true;
    const allowPrivateNetwork = shouldPromptAllowPrivateNetwork
        ? await params.prompter.confirm({
            message: "Allow private/internal Matrix homeserver traffic for this account?",
            initialValue: existing.allowPrivateNetwork === true || requiresAllowPrivateNetwork,
        })
        : false;
    if (requiresAllowPrivateNetwork && !allowPrivateNetwork) {
        throw new Error("Matrix homeserver requires allowPrivateNetwork for trusted private/internal access");
    }
    await resolveValidatedMatrixHomeserverUrl(homeserver, {
        allowPrivateNetwork,
    });
    let accessToken = existing.accessToken;
    let password = existing.password;
    let userId = existing.userId ?? "";
    if (hasConfiguredSecretInput(accessToken) || hasConfiguredSecretInput(password)) {
        const keep = await params.prompter.confirm({
            message: "Matrix credentials already configured. Keep them?",
            initialValue: true,
        });
        if (!keep) {
            accessToken = undefined;
            password = undefined;
            userId = "";
        }
    }
    if (!hasConfiguredSecretInput(accessToken) && !hasConfiguredSecretInput(password)) {
        const authMode = await params.prompter.select({
            message: "Matrix auth method",
            options: [
                { value: "token", label: "Access token (user ID fetched automatically)" },
                { value: "password", label: "Password (requires user ID)" },
            ],
        });
        if (authMode === "token") {
            accessToken = String(await params.prompter.text({
                message: "Matrix access token",
                validate: (value) => (value?.trim() ? undefined : "Required"),
            })).trim();
            password = undefined;
            userId = "";
        }
        else {
            userId = String(await params.prompter.text({
                message: "Matrix user ID",
                initialValue: existing.userId ?? envUserId,
                validate: (value) => {
                    const raw = String(value ?? "").trim();
                    if (!raw) {
                        return "Required";
                    }
                    if (!raw.startsWith("@")) {
                        return "Matrix user IDs should start with @";
                    }
                    if (!raw.includes(":")) {
                        return "Matrix user IDs should include a server (:server)";
                    }
                    return undefined;
                },
            })).trim();
            password = String(await params.prompter.text({
                message: "Matrix password",
                validate: (value) => (value?.trim() ? undefined : "Required"),
            })).trim();
            accessToken = undefined;
        }
    }
    const deviceName = String(await params.prompter.text({
        message: "Matrix device name (optional)",
        initialValue: existing.deviceName ?? "OpenClaw Gateway",
    })).trim();
    const enableEncryption = await params.prompter.confirm({
        message: "Enable end-to-end encryption (E2EE)?",
        initialValue: existing.encryption ?? false,
    });
    next = updateMatrixAccountConfig(next, accountId, {
        enabled: true,
        homeserver,
        ...(shouldPromptAllowPrivateNetwork
            ? { allowPrivateNetwork: allowPrivateNetwork ? true : null }
            : {}),
        userId: userId || null,
        accessToken: accessToken ?? null,
        password: password ?? null,
        deviceName: deviceName || null,
        encryption: enableEncryption,
    });
    if (params.forceAllowFrom) {
        next = await promptMatrixAllowFrom({
            cfg: next,
            prompter: params.prompter,
            accountId,
        });
    }
    const existingAccountConfig = resolveMatrixAccountConfig({ cfg: next, accountId });
    const existingGroups = existingAccountConfig.groups ?? existingAccountConfig.rooms;
    const accessConfig = await promptChannelAccessConfig({
        prompter: params.prompter,
        label: "Matrix rooms",
        currentPolicy: existingAccountConfig.groupPolicy ?? "allowlist",
        currentEntries: Object.keys(existingGroups ?? {}),
        placeholder: "!roomId:server, #alias:server, Project Room",
        updatePrompt: Boolean(existingGroups),
    });
    if (accessConfig) {
        if (accessConfig.policy !== "allowlist") {
            next = setMatrixGroupPolicy(next, accessConfig.policy, accountId);
        }
        else {
            let roomKeys = accessConfig.entries;
            if (accessConfig.entries.length > 0) {
                try {
                    const resolvedIds = [];
                    const unresolved = [];
                    for (const entry of accessConfig.entries) {
                        const trimmed = entry.trim();
                        if (!trimmed) {
                            continue;
                        }
                        const cleaned = trimmed.replace(/^(room|channel):/i, "").trim();
                        if (cleaned.startsWith("!") && cleaned.includes(":")) {
                            resolvedIds.push(cleaned);
                            continue;
                        }
                        const matches = await listMatrixDirectoryGroupsLive({
                            cfg: next,
                            accountId,
                            query: trimmed,
                            limit: 10,
                        });
                        const exact = matches.find((match) => (match.name ?? "").toLowerCase() === trimmed.toLowerCase());
                        const best = exact ?? matches[0];
                        if (best?.id) {
                            resolvedIds.push(best.id);
                        }
                        else {
                            unresolved.push(entry);
                        }
                    }
                    roomKeys = [...resolvedIds, ...unresolved.map((entry) => entry.trim()).filter(Boolean)];
                    if (resolvedIds.length > 0 || unresolved.length > 0) {
                        await params.prompter.note([
                            resolvedIds.length > 0 ? `Resolved: ${resolvedIds.join(", ")}` : undefined,
                            unresolved.length > 0
                                ? `Unresolved (kept as typed): ${unresolved.join(", ")}`
                                : undefined,
                        ]
                            .filter(Boolean)
                            .join("\n"), "Matrix rooms");
                    }
                }
                catch (err) {
                    await params.prompter.note(`Room lookup failed; keeping entries as typed. ${String(err)}`, "Matrix rooms");
                }
            }
            next = setMatrixGroupPolicy(next, "allowlist", accountId);
            next = setMatrixGroupRooms(next, roomKeys, accountId);
        }
    }
    return { cfg: next, accountId };
}
export const matrixOnboardingAdapter = {
    channel,
    getStatus: async ({ cfg, accountOverrides }) => {
        const resolvedCfg = cfg;
        const sdkReady = isMatrixSdkAvailable();
        if (!accountOverrides[channel] && requiresExplicitMatrixDefaultAccount(resolvedCfg)) {
            return {
                channel,
                configured: false,
                statusLines: ['Matrix: set "channels.matrix.defaultAccount" to select a named account'],
                selectionHint: !sdkReady ? "install matrix-js-sdk" : "set defaultAccount",
            };
        }
        const account = resolveMatrixAccount({
            cfg: resolvedCfg,
            accountId: resolveMatrixOnboardingAccountId(resolvedCfg, accountOverrides[channel]),
        });
        const configured = account.configured;
        return {
            channel,
            configured,
            statusLines: [
                `Matrix: ${configured ? "configured" : "needs homeserver + access token or password"}`,
            ],
            selectionHint: !sdkReady ? "install matrix-js-sdk" : configured ? "configured" : "needs auth",
        };
    },
    configure: async ({ cfg, runtime, prompter, forceAllowFrom, accountOverrides, shouldPromptAccountIds, }) => await runMatrixConfigure({
        cfg: cfg,
        runtime,
        prompter,
        forceAllowFrom,
        accountOverrides,
        shouldPromptAccountIds,
        intent: "update",
    }),
    configureInteractive: async ({ cfg, runtime, prompter, forceAllowFrom, accountOverrides, shouldPromptAccountIds, configured, }) => {
        if (!configured) {
            return await runMatrixConfigure({
                cfg: cfg,
                runtime,
                prompter,
                forceAllowFrom,
                accountOverrides,
                shouldPromptAccountIds,
                intent: "update",
            });
        }
        const action = await prompter.select({
            message: "Matrix already configured. What do you want to do?",
            options: [
                { value: "update", label: "Modify settings" },
                { value: "add-account", label: "Add account" },
                { value: "skip", label: "Skip (leave as-is)" },
            ],
            initialValue: "update",
        });
        if (action === "skip") {
            return "skip";
        }
        return await runMatrixConfigure({
            cfg: cfg,
            runtime,
            prompter,
            forceAllowFrom,
            accountOverrides,
            shouldPromptAccountIds,
            intent: action === "add-account" ? "add-account" : "update",
        });
    },
    afterConfigWritten: async ({ previousCfg, cfg, accountId, runtime }) => {
        const { runMatrixSetupBootstrapAfterConfigWrite } = await import("./setup-bootstrap.js");
        await runMatrixSetupBootstrapAfterConfigWrite({
            previousCfg: previousCfg,
            cfg: cfg,
            accountId,
            runtime,
        });
    },
    dmPolicy,
    disable: (cfg) => ({
        ...cfg,
        channels: {
            ...cfg.channels,
            matrix: { ...cfg.channels?.["matrix"], enabled: false },
        },
    }),
};
