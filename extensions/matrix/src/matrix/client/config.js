import { coerceSecretRef, resolveConfiguredSecretInputString, } from "openclaw/plugin-sdk/config-runtime";
import { requiresExplicitMatrixDefaultAccount, resolveMatrixDefaultOrOnlyAccountId, } from "../../account-selection.js";
import { resolveMatrixAccountStringValues } from "../../auth-precedence.js";
import { getMatrixScopedEnvVarNames } from "../../env-vars.js";
import { DEFAULT_ACCOUNT_ID, assertHttpUrlTargetsPrivateNetwork, isPrivateOrLoopbackHost, normalizeAccountId, normalizeOptionalAccountId, normalizeResolvedSecretInputString, ssrfPolicyFromAllowPrivateNetwork, } from "../../runtime-api.js";
import { getMatrixRuntime } from "../../runtime.js";
import { findMatrixAccountConfig, resolveMatrixBaseConfig, listNormalizedMatrixAccountIds, } from "../account-config.js";
import { resolveMatrixConfigFieldPath } from "../config-update.js";
import { credentialsMatchConfig, loadMatrixCredentials } from "../credentials-read.js";
import { MatrixClient } from "../sdk.js";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";
function readEnvSecretRefFallback(params) {
    const ref = coerceSecretRef(params.value, params.config?.secrets?.defaults);
    if (!ref || ref.source !== "env" || !params.env) {
        return undefined;
    }
    const providerConfig = params.config?.secrets?.providers?.[ref.provider];
    if (providerConfig) {
        if (providerConfig.source !== "env") {
            throw new Error(`Secret provider "${ref.provider}" has source "${providerConfig.source}" but ref requests "env".`);
        }
        if (providerConfig.allowlist && !providerConfig.allowlist.includes(ref.id)) {
            throw new Error(`Environment variable "${ref.id}" is not allowlisted in secrets.providers.${ref.provider}.allowlist.`);
        }
    }
    else if (ref.provider !== (params.config?.secrets?.defaults?.env?.trim() || "default")) {
        throw new Error(`Secret provider "${ref.provider}" is not configured (ref: ${ref.source}:${ref.provider}:${ref.id}).`);
    }
    const resolved = params.env[ref.id];
    if (typeof resolved !== "string") {
        return undefined;
    }
    const trimmed = resolved.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function clean(value, path, opts) {
    const ref = coerceSecretRef(value, opts?.config?.secrets?.defaults);
    if (opts?.suppressSecretRef && ref) {
        return "";
    }
    const normalizedValue = opts?.allowEnvSecretRefFallback
        ? ref?.source === "env"
            ? (readEnvSecretRefFallback({
                value,
                env: opts.env,
                config: opts.config,
            }) ?? value)
            : ref
                ? ""
                : value
        : value;
    return (normalizeResolvedSecretInputString({
        value: normalizedValue,
        path,
        defaults: opts?.config?.secrets?.defaults,
    }) ?? "");
}
function resolveMatrixBaseConfigFieldPath(field) {
    return `channels.matrix.${field}`;
}
function shouldAllowEnvSecretRefFallback(field) {
    return field === "accessToken" || field === "password";
}
function hasConfiguredSecretInputValue(value, cfg) {
    return ((typeof value === "string" && value.trim().length > 0) ||
        Boolean(coerceSecretRef(value, cfg.secrets?.defaults)));
}
function hasConfiguredMatrixAccessTokenSource(params) {
    const normalizedAccountId = normalizeAccountId(params.accountId);
    const account = findMatrixAccountConfig(params.cfg, normalizedAccountId) ?? {};
    const scopedAccessTokenVar = getMatrixScopedEnvVarNames(normalizedAccountId).accessToken;
    if (hasConfiguredSecretInputValue(account.accessToken, params.cfg) ||
        clean(params.env[scopedAccessTokenVar], scopedAccessTokenVar).length > 0) {
        return true;
    }
    if (normalizedAccountId !== DEFAULT_ACCOUNT_ID) {
        return false;
    }
    const matrix = resolveMatrixBaseConfig(params.cfg);
    return (hasConfiguredSecretInputValue(matrix.accessToken, params.cfg) ||
        clean(params.env.MATRIX_ACCESS_TOKEN, "MATRIX_ACCESS_TOKEN").length > 0);
}
function resolveConfiguredMatrixAuthInput(params) {
    const normalizedAccountId = normalizeAccountId(params.accountId);
    const account = findMatrixAccountConfig(params.cfg, normalizedAccountId) ?? {};
    const accountValue = account[params.field];
    if (accountValue !== undefined) {
        return {
            value: accountValue,
            path: resolveMatrixConfigFieldPath(params.cfg, normalizedAccountId, params.field),
        };
    }
    const scopedKeys = getMatrixScopedEnvVarNames(normalizedAccountId);
    const scopedEnv = resolveScopedMatrixEnvConfig(normalizedAccountId, params.env);
    const scopedValue = scopedEnv[params.field];
    if (scopedValue !== undefined) {
        return {
            value: scopedValue,
            path: params.field === "accessToken" ? scopedKeys.accessToken : scopedKeys.password,
        };
    }
    if (normalizedAccountId !== DEFAULT_ACCOUNT_ID) {
        return undefined;
    }
    const matrix = resolveMatrixBaseConfig(params.cfg);
    const baseValue = matrix[params.field];
    if (baseValue !== undefined) {
        return {
            value: baseValue,
            path: resolveMatrixBaseConfigFieldPath(params.field),
        };
    }
    const globalValue = params.field === "accessToken" ? params.env.MATRIX_ACCESS_TOKEN : params.env.MATRIX_PASSWORD;
    if (globalValue !== undefined) {
        return {
            value: globalValue,
            path: params.field === "accessToken" ? "MATRIX_ACCESS_TOKEN" : "MATRIX_PASSWORD",
        };
    }
    return undefined;
}
async function resolveConfiguredMatrixAuthSecretInput(params) {
    const configured = resolveConfiguredMatrixAuthInput(params);
    if (!configured) {
        return undefined;
    }
    const resolved = await resolveConfiguredSecretInputString({
        config: params.cfg,
        env: params.env,
        value: configured.value,
        path: configured.path,
        unresolvedReasonStyle: "detailed",
    });
    if (resolved.value !== undefined) {
        return resolved.value;
    }
    if (coerceSecretRef(configured.value, params.cfg.secrets?.defaults)) {
        throw new Error(resolved.unresolvedRefReason ?? `${configured.path} SecretRef could not be resolved.`);
    }
    return undefined;
}
function readMatrixBaseConfigField(matrix, field, opts) {
    return clean(matrix[field], resolveMatrixBaseConfigFieldPath(field), {
        env: opts?.env,
        config: opts?.config,
        allowEnvSecretRefFallback: shouldAllowEnvSecretRefFallback(field),
        suppressSecretRef: opts?.suppressSecretRef,
    });
}
function readMatrixAccountConfigField(cfg, accountId, account, field, opts) {
    return clean(account[field], resolveMatrixConfigFieldPath(cfg, accountId, field), {
        env: opts?.env,
        config: opts?.config,
        allowEnvSecretRefFallback: shouldAllowEnvSecretRefFallback(field),
        suppressSecretRef: opts?.suppressSecretRef,
    });
}
function clampMatrixInitialSyncLimit(value) {
    return typeof value === "number" ? Math.max(0, Math.floor(value)) : undefined;
}
const MATRIX_HTTP_HOMESERVER_ERROR = "Matrix homeserver must use https:// unless it targets a private or loopback host";
function buildMatrixNetworkFields(allowPrivateNetwork) {
    if (!allowPrivateNetwork) {
        return {};
    }
    return {
        allowPrivateNetwork: true,
        ssrfPolicy: ssrfPolicyFromAllowPrivateNetwork(true),
    };
}
function resolveGlobalMatrixEnvConfig(env) {
    return {
        homeserver: clean(env.MATRIX_HOMESERVER, "MATRIX_HOMESERVER"),
        userId: clean(env.MATRIX_USER_ID, "MATRIX_USER_ID"),
        accessToken: clean(env.MATRIX_ACCESS_TOKEN, "MATRIX_ACCESS_TOKEN") || undefined,
        password: clean(env.MATRIX_PASSWORD, "MATRIX_PASSWORD") || undefined,
        deviceId: clean(env.MATRIX_DEVICE_ID, "MATRIX_DEVICE_ID") || undefined,
        deviceName: clean(env.MATRIX_DEVICE_NAME, "MATRIX_DEVICE_NAME") || undefined,
    };
}
export { getMatrixScopedEnvVarNames } from "../../env-vars.js";
export function resolveMatrixEnvAuthReadiness(accountId, env = process.env) {
    const normalizedAccountId = normalizeAccountId(accountId);
    const scoped = resolveScopedMatrixEnvConfig(normalizedAccountId, env);
    const scopedReady = hasReadyMatrixEnvAuth(scoped);
    if (normalizedAccountId !== DEFAULT_ACCOUNT_ID) {
        const keys = getMatrixScopedEnvVarNames(normalizedAccountId);
        return {
            ready: scopedReady,
            homeserver: scoped.homeserver || undefined,
            userId: scoped.userId || undefined,
            sourceHint: `${keys.homeserver} (+ auth vars)`,
            missingMessage: `Set per-account env vars for "${normalizedAccountId}" (for example ${keys.homeserver} + ${keys.accessToken} or ${keys.userId} + ${keys.password}).`,
        };
    }
    const defaultScoped = resolveScopedMatrixEnvConfig(DEFAULT_ACCOUNT_ID, env);
    const global = resolveGlobalMatrixEnvConfig(env);
    const defaultScopedReady = hasReadyMatrixEnvAuth(defaultScoped);
    const globalReady = hasReadyMatrixEnvAuth(global);
    const defaultKeys = getMatrixScopedEnvVarNames(DEFAULT_ACCOUNT_ID);
    return {
        ready: defaultScopedReady || globalReady,
        homeserver: defaultScoped.homeserver || global.homeserver || undefined,
        userId: defaultScoped.userId || global.userId || undefined,
        sourceHint: "MATRIX_* or MATRIX_DEFAULT_*",
        missingMessage: `Set Matrix env vars for the default account ` +
            `(for example MATRIX_HOMESERVER + MATRIX_ACCESS_TOKEN, MATRIX_USER_ID + MATRIX_PASSWORD, ` +
            `or ${defaultKeys.homeserver} + ${defaultKeys.accessToken}).`,
    };
}
export function resolveScopedMatrixEnvConfig(accountId, env = process.env) {
    const keys = getMatrixScopedEnvVarNames(accountId);
    return {
        homeserver: clean(env[keys.homeserver], keys.homeserver),
        userId: clean(env[keys.userId], keys.userId),
        accessToken: clean(env[keys.accessToken], keys.accessToken) || undefined,
        password: clean(env[keys.password], keys.password) || undefined,
        deviceId: clean(env[keys.deviceId], keys.deviceId) || undefined,
        deviceName: clean(env[keys.deviceName], keys.deviceName) || undefined,
    };
}
function hasScopedMatrixEnvConfig(accountId, env) {
    const scoped = resolveScopedMatrixEnvConfig(accountId, env);
    return Boolean(scoped.homeserver ||
        scoped.userId ||
        scoped.accessToken ||
        scoped.password ||
        scoped.deviceId ||
        scoped.deviceName);
}
export function hasReadyMatrixEnvAuth(config) {
    const homeserver = clean(config.homeserver, "matrix.env.homeserver");
    const userId = clean(config.userId, "matrix.env.userId");
    const accessToken = clean(config.accessToken, "matrix.env.accessToken");
    const password = clean(config.password, "matrix.env.password");
    return Boolean(homeserver && (accessToken || (userId && password)));
}
export function validateMatrixHomeserverUrl(homeserver, opts) {
    const trimmed = clean(homeserver, "matrix.homeserver");
    if (!trimmed) {
        throw new Error("Matrix homeserver is required (matrix.homeserver)");
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw new Error("Matrix homeserver must be a valid http(s) URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Matrix homeserver must use http:// or https://");
    }
    if (!parsed.hostname) {
        throw new Error("Matrix homeserver must include a hostname");
    }
    if (parsed.username || parsed.password) {
        throw new Error("Matrix homeserver URL must not include embedded credentials");
    }
    if (parsed.search || parsed.hash) {
        throw new Error("Matrix homeserver URL must not include query strings or fragments");
    }
    if (parsed.protocol === "http:" &&
        opts?.allowPrivateNetwork !== true &&
        !isPrivateOrLoopbackHost(parsed.hostname)) {
        throw new Error(MATRIX_HTTP_HOMESERVER_ERROR);
    }
    return trimmed;
}
export async function resolveValidatedMatrixHomeserverUrl(homeserver, opts) {
    const normalized = validateMatrixHomeserverUrl(homeserver, opts);
    await assertHttpUrlTargetsPrivateNetwork(normalized, {
        allowPrivateNetwork: opts?.allowPrivateNetwork,
        lookupFn: opts?.lookupFn,
        errorMessage: MATRIX_HTTP_HOMESERVER_ERROR,
    });
    return normalized;
}
export function resolveMatrixConfig(cfg = getMatrixRuntime().config.loadConfig(), env = process.env) {
    const matrix = resolveMatrixBaseConfig(cfg);
    const suppressInactivePasswordSecretRef = hasConfiguredMatrixAccessTokenSource({
        cfg,
        env,
        accountId: DEFAULT_ACCOUNT_ID,
    });
    const fieldReadOptions = {
        env,
        config: cfg,
    };
    const defaultScopedEnv = resolveScopedMatrixEnvConfig(DEFAULT_ACCOUNT_ID, env);
    const globalEnv = resolveGlobalMatrixEnvConfig(env);
    const resolvedStrings = resolveMatrixAccountStringValues({
        accountId: DEFAULT_ACCOUNT_ID,
        scopedEnv: defaultScopedEnv,
        channel: {
            homeserver: readMatrixBaseConfigField(matrix, "homeserver", fieldReadOptions),
            userId: readMatrixBaseConfigField(matrix, "userId", fieldReadOptions),
            accessToken: readMatrixBaseConfigField(matrix, "accessToken", fieldReadOptions),
            password: readMatrixBaseConfigField(matrix, "password", {
                ...fieldReadOptions,
                suppressSecretRef: suppressInactivePasswordSecretRef,
            }),
            deviceId: readMatrixBaseConfigField(matrix, "deviceId", fieldReadOptions),
            deviceName: readMatrixBaseConfigField(matrix, "deviceName", fieldReadOptions),
        },
        globalEnv,
    });
    const initialSyncLimit = clampMatrixInitialSyncLimit(matrix.initialSyncLimit);
    const encryption = matrix.encryption ?? false;
    const allowPrivateNetwork = matrix.allowPrivateNetwork === true ? true : undefined;
    return {
        homeserver: resolvedStrings.homeserver,
        userId: resolvedStrings.userId,
        accessToken: resolvedStrings.accessToken || undefined,
        password: resolvedStrings.password || undefined,
        deviceId: resolvedStrings.deviceId || undefined,
        deviceName: resolvedStrings.deviceName || undefined,
        initialSyncLimit,
        encryption,
        ...buildMatrixNetworkFields(allowPrivateNetwork),
    };
}
export function resolveMatrixConfigForAccount(cfg, accountId, env = process.env) {
    const matrix = resolveMatrixBaseConfig(cfg);
    const account = findMatrixAccountConfig(cfg, accountId) ?? {};
    const normalizedAccountId = normalizeAccountId(accountId);
    const suppressInactivePasswordSecretRef = hasConfiguredMatrixAccessTokenSource({
        cfg,
        env,
        accountId: normalizedAccountId,
    });
    const fieldReadOptions = {
        env,
        config: cfg,
    };
    const scopedEnv = resolveScopedMatrixEnvConfig(normalizedAccountId, env);
    const globalEnv = resolveGlobalMatrixEnvConfig(env);
    const accountField = (field) => readMatrixAccountConfigField(cfg, normalizedAccountId, account, field, {
        ...fieldReadOptions,
        suppressSecretRef: field === "password" ? suppressInactivePasswordSecretRef : undefined,
    });
    const resolvedStrings = resolveMatrixAccountStringValues({
        accountId: normalizedAccountId,
        account: {
            homeserver: accountField("homeserver"),
            userId: accountField("userId"),
            accessToken: accountField("accessToken"),
            password: accountField("password"),
            deviceId: accountField("deviceId"),
            deviceName: accountField("deviceName"),
        },
        scopedEnv,
        channel: {
            homeserver: readMatrixBaseConfigField(matrix, "homeserver", fieldReadOptions),
            userId: readMatrixBaseConfigField(matrix, "userId", fieldReadOptions),
            accessToken: readMatrixBaseConfigField(matrix, "accessToken", fieldReadOptions),
            password: readMatrixBaseConfigField(matrix, "password", {
                ...fieldReadOptions,
                suppressSecretRef: suppressInactivePasswordSecretRef,
            }),
            deviceId: readMatrixBaseConfigField(matrix, "deviceId", fieldReadOptions),
            deviceName: readMatrixBaseConfigField(matrix, "deviceName", fieldReadOptions),
        },
        globalEnv,
    });
    const accountInitialSyncLimit = clampMatrixInitialSyncLimit(account.initialSyncLimit);
    const initialSyncLimit = accountInitialSyncLimit ?? clampMatrixInitialSyncLimit(matrix.initialSyncLimit);
    const encryption = typeof account.encryption === "boolean" ? account.encryption : (matrix.encryption ?? false);
    const allowPrivateNetwork = account.allowPrivateNetwork === true || matrix.allowPrivateNetwork === true ? true : undefined;
    return {
        homeserver: resolvedStrings.homeserver,
        userId: resolvedStrings.userId,
        accessToken: resolvedStrings.accessToken || undefined,
        password: resolvedStrings.password || undefined,
        deviceId: resolvedStrings.deviceId || undefined,
        deviceName: resolvedStrings.deviceName || undefined,
        initialSyncLimit,
        encryption,
        ...buildMatrixNetworkFields(allowPrivateNetwork),
    };
}
export function resolveImplicitMatrixAccountId(cfg, _env = process.env) {
    if (requiresExplicitMatrixDefaultAccount(cfg)) {
        return null;
    }
    return normalizeAccountId(resolveMatrixDefaultOrOnlyAccountId(cfg));
}
export function resolveMatrixAuthContext(params) {
    const cfg = params?.cfg ?? getMatrixRuntime().config.loadConfig();
    const env = params?.env ?? process.env;
    const explicitAccountId = normalizeOptionalAccountId(params?.accountId);
    const effectiveAccountId = explicitAccountId ?? resolveImplicitMatrixAccountId(cfg, env);
    if (!effectiveAccountId) {
        throw new Error('Multiple Matrix accounts are configured and channels.matrix.defaultAccount is not set. Set "channels.matrix.defaultAccount" to the intended account or pass --account <id>.');
    }
    if (explicitAccountId &&
        explicitAccountId !== DEFAULT_ACCOUNT_ID &&
        !listNormalizedMatrixAccountIds(cfg).includes(explicitAccountId) &&
        !hasScopedMatrixEnvConfig(explicitAccountId, env)) {
        throw new Error(`Matrix account "${explicitAccountId}" is not configured. Add channels.matrix.accounts.${explicitAccountId} or define scoped ${getMatrixScopedEnvVarNames(explicitAccountId).accessToken.replace(/_ACCESS_TOKEN$/, "")}_* variables.`);
    }
    const resolved = resolveMatrixConfigForAccount(cfg, effectiveAccountId, env);
    return {
        cfg,
        env,
        accountId: effectiveAccountId,
        resolved,
    };
}
export async function resolveMatrixAuth(params) {
    const { cfg, env, accountId, resolved } = resolveMatrixAuthContext(params);
    const accessToken = (await resolveConfiguredMatrixAuthSecretInput({
        cfg,
        env,
        accountId,
        field: "accessToken",
    })) ?? resolved.accessToken;
    const tokenAuthPassword = resolved.password;
    const homeserver = await resolveValidatedMatrixHomeserverUrl(resolved.homeserver, {
        allowPrivateNetwork: resolved.allowPrivateNetwork,
    });
    let credentialsWriter;
    const loadCredentialsWriter = async () => {
        credentialsWriter ??= await import("../credentials-write.runtime.js");
        return credentialsWriter;
    };
    const cached = loadMatrixCredentials(env, accountId);
    const cachedCredentials = cached &&
        credentialsMatchConfig(cached, {
            homeserver,
            userId: resolved.userId || "",
            accessToken,
        })
        ? cached
        : null;
    // If we have an access token, we can fetch userId via whoami if not provided
    if (accessToken) {
        let userId = resolved.userId;
        const hasMatchingCachedToken = cachedCredentials?.accessToken === accessToken;
        let knownDeviceId = hasMatchingCachedToken
            ? cachedCredentials?.deviceId || resolved.deviceId
            : resolved.deviceId;
        if (!userId || !knownDeviceId) {
            // Fetch whoami when we need to resolve userId and/or deviceId from token auth.
            ensureMatrixSdkLoggingConfigured();
            const tempClient = new MatrixClient(homeserver, accessToken, undefined, undefined, {
                ssrfPolicy: resolved.ssrfPolicy,
            });
            const whoami = (await tempClient.doRequest("GET", "/_matrix/client/v3/account/whoami"));
            if (!userId) {
                const fetchedUserId = whoami.user_id?.trim();
                if (!fetchedUserId) {
                    throw new Error("Matrix whoami did not return user_id");
                }
                userId = fetchedUserId;
            }
            if (!knownDeviceId) {
                knownDeviceId = whoami.device_id?.trim() || resolved.deviceId;
            }
        }
        const shouldRefreshCachedCredentials = !cachedCredentials ||
            !hasMatchingCachedToken ||
            cachedCredentials.userId !== userId ||
            (cachedCredentials.deviceId || undefined) !== knownDeviceId;
        if (shouldRefreshCachedCredentials) {
            const { saveMatrixCredentials } = await loadCredentialsWriter();
            await saveMatrixCredentials({
                homeserver,
                userId,
                accessToken,
                deviceId: knownDeviceId,
            }, env, accountId);
        }
        else if (hasMatchingCachedToken) {
            const { touchMatrixCredentials } = await loadCredentialsWriter();
            await touchMatrixCredentials(env, accountId);
        }
        return {
            accountId,
            homeserver,
            userId,
            accessToken,
            password: tokenAuthPassword,
            deviceId: knownDeviceId,
            deviceName: resolved.deviceName,
            initialSyncLimit: resolved.initialSyncLimit,
            encryption: resolved.encryption,
            ...buildMatrixNetworkFields(resolved.allowPrivateNetwork),
        };
    }
    if (cachedCredentials) {
        const { touchMatrixCredentials } = await loadCredentialsWriter();
        await touchMatrixCredentials(env, accountId);
        return {
            accountId,
            homeserver: cachedCredentials.homeserver,
            userId: cachedCredentials.userId,
            accessToken: cachedCredentials.accessToken,
            password: tokenAuthPassword,
            deviceId: cachedCredentials.deviceId || resolved.deviceId,
            deviceName: resolved.deviceName,
            initialSyncLimit: resolved.initialSyncLimit,
            encryption: resolved.encryption,
            ...buildMatrixNetworkFields(resolved.allowPrivateNetwork),
        };
    }
    if (!resolved.userId) {
        throw new Error("Matrix userId is required when no access token is configured (matrix.userId)");
    }
    const password = (await resolveConfiguredMatrixAuthSecretInput({
        cfg,
        env,
        accountId,
        field: "password",
    })) ?? resolved.password;
    if (!password) {
        throw new Error("Matrix password is required when no access token is configured (matrix.password)");
    }
    // Login with password using the same hardened request path as other Matrix HTTP calls.
    ensureMatrixSdkLoggingConfigured();
    const loginClient = new MatrixClient(homeserver, "", undefined, undefined, {
        ssrfPolicy: resolved.ssrfPolicy,
    });
    const login = (await loginClient.doRequest("POST", "/_matrix/client/v3/login", undefined, {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: resolved.userId },
        password,
        device_id: resolved.deviceId,
        initial_device_display_name: resolved.deviceName ?? "OpenClaw Gateway",
    }));
    const loginAccessToken = login.access_token?.trim();
    if (!loginAccessToken) {
        throw new Error("Matrix login did not return an access token");
    }
    const auth = {
        accountId,
        homeserver,
        userId: login.user_id ?? resolved.userId,
        accessToken: loginAccessToken,
        password,
        deviceId: login.device_id ?? resolved.deviceId,
        deviceName: resolved.deviceName,
        initialSyncLimit: resolved.initialSyncLimit,
        encryption: resolved.encryption,
        ...buildMatrixNetworkFields(resolved.allowPrivateNetwork),
    };
    const { saveMatrixCredentials } = await loadCredentialsWriter();
    await saveMatrixCredentials({
        homeserver: auth.homeserver,
        userId: auth.userId,
        accessToken: auth.accessToken,
        deviceId: auth.deviceId,
    }, env, accountId);
    return auth;
}
