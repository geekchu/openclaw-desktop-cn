import { randomUUID } from "node:crypto";
import { loadConfig, resolveConfigPath, resolveGatewayPort, resolveStateDir, } from "../config/config.js";
import { loadConfig as loadConfigFromIo } from "../config/io.js";
import { resolveConfigPath as resolveConfigPathFromPaths, resolveGatewayPort as resolveGatewayPortFromPaths, resolveStateDir as resolveStateDirFromPaths, } from "../config/paths.js";
import { resolveSecretInputRef } from "../config/types.secrets.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { loadGatewayTlsRuntime } from "../infra/tls/gateway.js";
import { resolveSecretInputString } from "../secrets/resolve-secret-input-string.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES, } from "../utils/message-channel.js";
import { VERSION } from "../version.js";
import { GatewayClient } from "./client.js";
import { buildGatewayConnectionDetailsWithResolvers, } from "./connection-details.js";
import { GatewaySecretRefUnavailableError, resolveGatewayCredentialsFromConfig, trimToUndefined, } from "./credentials.js";
import { CLI_DEFAULT_OPERATOR_SCOPES, resolveLeastPrivilegeOperatorScopesForMethod, } from "./method-scopes.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
const defaultCreateGatewayClient = (opts) => new GatewayClient(opts);
const defaultGatewayCallDeps = {
    createGatewayClient: defaultCreateGatewayClient,
    loadConfig,
    loadOrCreateDeviceIdentity,
    resolveGatewayPort,
    resolveConfigPath,
    resolveStateDir,
    loadGatewayTlsRuntime,
};
const gatewayCallDeps = {
    ...defaultGatewayCallDeps,
};
function loadGatewayConfig() {
    const loadConfigFn = typeof gatewayCallDeps.loadConfig === "function"
        ? gatewayCallDeps.loadConfig
        : typeof defaultGatewayCallDeps.loadConfig === "function"
            ? defaultGatewayCallDeps.loadConfig
            : loadConfigFromIo;
    return loadConfigFn();
}
function resolveGatewayStateDir(env) {
    const resolveStateDirFn = typeof gatewayCallDeps.resolveStateDir === "function"
        ? gatewayCallDeps.resolveStateDir
        : resolveStateDirFromPaths;
    return resolveStateDirFn(env);
}
function resolveGatewayConfigPath(env) {
    const resolveConfigPathFn = typeof gatewayCallDeps.resolveConfigPath === "function"
        ? gatewayCallDeps.resolveConfigPath
        : resolveConfigPathFromPaths;
    return resolveConfigPathFn(env, resolveGatewayStateDir(env));
}
function resolveGatewayPortValue(config, env) {
    const resolveGatewayPortFn = typeof gatewayCallDeps.resolveGatewayPort === "function"
        ? gatewayCallDeps.resolveGatewayPort
        : resolveGatewayPortFromPaths;
    return resolveGatewayPortFn(config, env);
}
export function buildGatewayConnectionDetails(options = {}) {
    return buildGatewayConnectionDetailsWithResolvers(options, {
        loadConfig: () => loadGatewayConfig(),
        resolveConfigPath: (env) => resolveGatewayConfigPath(env),
        resolveGatewayPort: (config, env) => resolveGatewayPortValue(config, env),
    });
}
export const __testing = {
    setDepsForTests(deps) {
        gatewayCallDeps.createGatewayClient =
            deps?.createGatewayClient ?? defaultGatewayCallDeps.createGatewayClient;
        gatewayCallDeps.loadConfig = deps?.loadConfig ?? defaultGatewayCallDeps.loadConfig;
        gatewayCallDeps.loadOrCreateDeviceIdentity =
            deps?.loadOrCreateDeviceIdentity ?? defaultGatewayCallDeps.loadOrCreateDeviceIdentity;
        gatewayCallDeps.resolveGatewayPort =
            deps?.resolveGatewayPort ?? defaultGatewayCallDeps.resolveGatewayPort;
        gatewayCallDeps.resolveConfigPath =
            deps?.resolveConfigPath ?? defaultGatewayCallDeps.resolveConfigPath;
        gatewayCallDeps.resolveStateDir =
            deps?.resolveStateDir ?? defaultGatewayCallDeps.resolveStateDir;
        gatewayCallDeps.loadGatewayTlsRuntime =
            deps?.loadGatewayTlsRuntime ?? defaultGatewayCallDeps.loadGatewayTlsRuntime;
    },
    setCreateGatewayClientForTests(createGatewayClient) {
        gatewayCallDeps.createGatewayClient =
            createGatewayClient ?? defaultGatewayCallDeps.createGatewayClient;
    },
    resetDepsForTests() {
        gatewayCallDeps.createGatewayClient = defaultGatewayCallDeps.createGatewayClient;
        gatewayCallDeps.loadConfig = defaultGatewayCallDeps.loadConfig;
        gatewayCallDeps.loadOrCreateDeviceIdentity = defaultGatewayCallDeps.loadOrCreateDeviceIdentity;
        gatewayCallDeps.resolveGatewayPort = defaultGatewayCallDeps.resolveGatewayPort;
        gatewayCallDeps.resolveConfigPath = defaultGatewayCallDeps.resolveConfigPath;
        gatewayCallDeps.resolveStateDir = defaultGatewayCallDeps.resolveStateDir;
        gatewayCallDeps.loadGatewayTlsRuntime = defaultGatewayCallDeps.loadGatewayTlsRuntime;
    },
};
function resolveDeviceIdentityForGatewayCall() {
    // Shared-auth local calls should still stay device-bound so operator scopes
    // remain available for detail RPCs such as status / system-presence /
    // last-heartbeat.
    try {
        return gatewayCallDeps.loadOrCreateDeviceIdentity();
    }
    catch {
        // Read-only or restricted environments should still be able to call the
        // gateway with token/password auth without crashing before the RPC.
        return null;
    }
}
export function resolveExplicitGatewayAuth(opts) {
    const token = typeof opts?.token === "string" && opts.token.trim().length > 0 ? opts.token.trim() : undefined;
    const password = typeof opts?.password === "string" && opts.password.trim().length > 0
        ? opts.password.trim()
        : undefined;
    return { token, password };
}
export function ensureExplicitGatewayAuth(params) {
    if (!params.urlOverride) {
        return;
    }
    // URL overrides are untrusted redirects and can move WebSocket traffic off the intended host.
    // Never allow an override to silently reuse implicit credentials or device token fallback.
    const explicitToken = params.explicitAuth?.token;
    const explicitPassword = params.explicitAuth?.password;
    if (params.urlOverrideSource === "cli" && (explicitToken || explicitPassword)) {
        return;
    }
    const hasResolvedAuth = params.resolvedAuth?.token ||
        params.resolvedAuth?.password ||
        explicitToken ||
        explicitPassword;
    // Env overrides are supported for deployment ergonomics, but only when explicit auth is available.
    // This avoids implicit device-token fallback against attacker-controlled WSS endpoints.
    if (params.urlOverrideSource === "env" && hasResolvedAuth) {
        return;
    }
    const message = [
        "gateway url override requires explicit credentials",
        params.errorHint,
        params.configPath ? `Config: ${params.configPath}` : undefined,
    ]
        .filter(Boolean)
        .join("\n");
    throw new Error(message);
}
function resolveGatewayCallTimeout(timeoutValue) {
    const timeoutMs = typeof timeoutValue === "number" && Number.isFinite(timeoutValue) ? timeoutValue : 10_000;
    const safeTimerTimeoutMs = Math.max(1, Math.min(Math.floor(timeoutMs), 2_147_483_647));
    return { timeoutMs, safeTimerTimeoutMs };
}
function resolveGatewayCallContext(opts) {
    const config = opts.config ?? loadGatewayConfig();
    const configPath = opts.configPath ?? resolveGatewayConfigPath(process.env);
    const isRemoteMode = config.gateway?.mode === "remote";
    const remote = isRemoteMode
        ? config.gateway?.remote
        : undefined;
    const cliUrlOverride = trimToUndefined(opts.url);
    const envUrlOverride = cliUrlOverride
        ? undefined
        : trimToUndefined(process.env.OPENCLAW_GATEWAY_URL);
    const urlOverride = cliUrlOverride ?? envUrlOverride;
    const urlOverrideSource = cliUrlOverride ? "cli" : envUrlOverride ? "env" : undefined;
    const remoteUrl = trimToUndefined(remote?.url);
    const explicitAuth = resolveExplicitGatewayAuth({ token: opts.token, password: opts.password });
    return {
        config,
        configPath,
        isRemoteMode,
        remote,
        urlOverride,
        urlOverrideSource,
        remoteUrl,
        explicitAuth,
    };
}
function ensureRemoteModeUrlConfigured(context) {
    if (!context.isRemoteMode || context.urlOverride || context.remoteUrl) {
        return;
    }
    throw new Error([
        "gateway remote mode misconfigured: gateway.remote.url missing",
        `Config: ${context.configPath}`,
        "Fix: set gateway.remote.url, or set gateway.mode=local.",
    ].join("\n"));
}
async function resolveGatewaySecretInputString(params) {
    const value = await resolveSecretInputString({
        config: params.config,
        value: params.value,
        env: params.env,
        normalize: trimToUndefined,
        onResolveRefError: () => {
            throw new GatewaySecretRefUnavailableError(params.path);
        },
    });
    if (!value) {
        throw new Error(`${params.path} resolved to an empty or non-string value.`);
    }
    return value;
}
async function resolveGatewayCredentials(context) {
    return resolveGatewayCredentialsWithEnv(context, process.env);
}
async function resolveGatewayCredentialsWithEnv(context, env) {
    if (context.explicitAuth.token || context.explicitAuth.password) {
        return {
            token: context.explicitAuth.token,
            password: context.explicitAuth.password,
        };
    }
    return resolveGatewayCredentialsFromConfigWithSecretInputs({ context, env });
}
const ALL_GATEWAY_SECRET_INPUT_PATHS = [
    "gateway.auth.token",
    "gateway.auth.password",
    "gateway.remote.token",
    "gateway.remote.password",
];
function isSupportedGatewaySecretInputPath(path) {
    return (path === "gateway.auth.token" ||
        path === "gateway.auth.password" ||
        path === "gateway.remote.token" ||
        path === "gateway.remote.password");
}
function readGatewaySecretInputValue(config, path) {
    if (path === "gateway.auth.token") {
        return config.gateway?.auth?.token;
    }
    if (path === "gateway.auth.password") {
        return config.gateway?.auth?.password;
    }
    if (path === "gateway.remote.token") {
        return config.gateway?.remote?.token;
    }
    return config.gateway?.remote?.password;
}
function hasConfiguredGatewaySecretRef(config, path) {
    return Boolean(resolveSecretInputRef({
        value: readGatewaySecretInputValue(config, path),
        defaults: config.secrets?.defaults,
    }).ref);
}
function resolveGatewayCredentialsFromConfigOptions(params) {
    const { context, env, cfg } = params;
    return {
        cfg,
        env,
        explicitAuth: context.explicitAuth,
        urlOverride: context.urlOverride,
        urlOverrideSource: context.urlOverrideSource,
        modeOverride: context.modeOverride,
        localTokenPrecedence: context.localTokenPrecedence,
        localPasswordPrecedence: context.localPasswordPrecedence,
        remoteTokenPrecedence: context.remoteTokenPrecedence,
        remotePasswordPrecedence: context.remotePasswordPrecedence ?? "env-first", // pragma: allowlist secret
        remoteTokenFallback: context.remoteTokenFallback,
        remotePasswordFallback: context.remotePasswordFallback,
    };
}
function isTokenGatewaySecretInputPath(path) {
    return path === "gateway.auth.token" || path === "gateway.remote.token";
}
function localAuthModeAllowsGatewaySecretInputPath(params) {
    const { authMode, path } = params;
    if (authMode === "none" || authMode === "trusted-proxy") {
        return false;
    }
    if (authMode === "token") {
        return isTokenGatewaySecretInputPath(path);
    }
    if (authMode === "password") {
        return !isTokenGatewaySecretInputPath(path);
    }
    return true;
}
function gatewaySecretInputPathCanWin(params) {
    if (!hasConfiguredGatewaySecretRef(params.config, params.path)) {
        return false;
    }
    const mode = params.context.modeOverride ?? (params.config.gateway?.mode === "remote" ? "remote" : "local");
    if (mode === "local" &&
        !localAuthModeAllowsGatewaySecretInputPath({
            authMode: params.config.gateway?.auth?.mode,
            path: params.path,
        })) {
        return false;
    }
    const sentinel = `__OPENCLAW_GATEWAY_SECRET_REF_PROBE_${params.path.replaceAll(".", "_")}__`;
    const probeConfig = structuredClone(params.config);
    for (const candidatePath of ALL_GATEWAY_SECRET_INPUT_PATHS) {
        if (!hasConfiguredGatewaySecretRef(probeConfig, candidatePath)) {
            continue;
        }
        assignResolvedGatewaySecretInput({
            config: probeConfig,
            path: candidatePath,
            value: undefined,
        });
    }
    assignResolvedGatewaySecretInput({
        config: probeConfig,
        path: params.path,
        value: sentinel,
    });
    try {
        const resolved = resolveGatewayCredentialsFromConfig(resolveGatewayCredentialsFromConfigOptions({
            context: params.context,
            env: params.env,
            cfg: probeConfig,
        }));
        const tokenCanWin = resolved.token === sentinel && !resolved.password;
        const passwordCanWin = resolved.password === sentinel && !resolved.token;
        return tokenCanWin || passwordCanWin;
    }
    catch {
        return false;
    }
}
async function resolveConfiguredGatewaySecretInput(params) {
    const { config, path, env } = params;
    if (path === "gateway.auth.token") {
        return resolveGatewaySecretInputString({
            config,
            value: config.gateway?.auth?.token,
            path,
            env,
        });
    }
    if (path === "gateway.auth.password") {
        return resolveGatewaySecretInputString({
            config,
            value: config.gateway?.auth?.password,
            path,
            env,
        });
    }
    if (path === "gateway.remote.token") {
        return resolveGatewaySecretInputString({
            config,
            value: config.gateway?.remote?.token,
            path,
            env,
        });
    }
    return resolveGatewaySecretInputString({
        config,
        value: config.gateway?.remote?.password,
        path,
        env,
    });
}
function assignResolvedGatewaySecretInput(params) {
    const { config, path, value } = params;
    if (path === "gateway.auth.token") {
        if (config.gateway?.auth) {
            config.gateway.auth.token = value;
        }
        return;
    }
    if (path === "gateway.auth.password") {
        if (config.gateway?.auth) {
            config.gateway.auth.password = value;
        }
        return;
    }
    if (path === "gateway.remote.token") {
        if (config.gateway?.remote) {
            config.gateway.remote.token = value;
        }
        return;
    }
    if (config.gateway?.remote) {
        config.gateway.remote.password = value;
    }
}
async function resolvePreferredGatewaySecretInputs(params) {
    let nextConfig = params.config;
    for (const path of ALL_GATEWAY_SECRET_INPUT_PATHS) {
        if (!gatewaySecretInputPathCanWin({
            context: params.context,
            env: params.env,
            config: nextConfig,
            path,
        })) {
            continue;
        }
        if (nextConfig === params.config) {
            nextConfig = structuredClone(params.config);
        }
        try {
            const resolvedValue = await resolveConfiguredGatewaySecretInput({
                config: nextConfig,
                path,
                env: params.env,
            });
            assignResolvedGatewaySecretInput({
                config: nextConfig,
                path,
                value: resolvedValue,
            });
        }
        catch {
            // Keep scanning candidate paths so unresolved higher-priority refs do not
            // prevent valid fallback refs from being considered.
            continue;
        }
    }
    return nextConfig;
}
async function resolveGatewayCredentialsFromConfigWithSecretInputs(params) {
    let resolvedConfig = await resolvePreferredGatewaySecretInputs({
        context: params.context,
        env: params.env,
        config: params.context.config,
    });
    const resolvedPaths = new Set();
    for (;;) {
        try {
            return resolveGatewayCredentialsFromConfig(resolveGatewayCredentialsFromConfigOptions({
                context: params.context,
                env: params.env,
                cfg: resolvedConfig,
            }));
        }
        catch (error) {
            if (!(error instanceof GatewaySecretRefUnavailableError)) {
                throw error;
            }
            const path = error.path;
            if (!isSupportedGatewaySecretInputPath(path) || resolvedPaths.has(path)) {
                throw error;
            }
            if (resolvedConfig === params.context.config) {
                resolvedConfig = structuredClone(params.context.config);
            }
            const resolvedValue = await resolveConfiguredGatewaySecretInput({
                config: resolvedConfig,
                path,
                env: params.env,
            });
            assignResolvedGatewaySecretInput({
                config: resolvedConfig,
                path,
                value: resolvedValue,
            });
            resolvedPaths.add(path);
        }
    }
}
export async function resolveGatewayCredentialsWithSecretInputs(params) {
    const modeOverride = params.modeOverride;
    const isRemoteMode = modeOverride
        ? modeOverride === "remote"
        : params.config.gateway?.mode === "remote";
    const remoteFromConfig = params.config.gateway?.mode === "remote"
        ? params.config.gateway?.remote
        : undefined;
    const remoteFromOverride = modeOverride === "remote"
        ? params.config.gateway?.remote
        : undefined;
    const context = {
        config: params.config,
        configPath: resolveGatewayConfigPath(process.env),
        isRemoteMode,
        remote: remoteFromOverride ?? remoteFromConfig,
        urlOverride: trimToUndefined(params.urlOverride),
        urlOverrideSource: params.urlOverrideSource,
        remoteUrl: isRemoteMode
            ? trimToUndefined(params.config.gateway?.remote?.url)
            : undefined,
        explicitAuth: resolveExplicitGatewayAuth(params.explicitAuth),
        modeOverride,
        localTokenPrecedence: params.localTokenPrecedence,
        localPasswordPrecedence: params.localPasswordPrecedence,
        remoteTokenPrecedence: params.remoteTokenPrecedence,
        remotePasswordPrecedence: params.remotePasswordPrecedence,
        remoteTokenFallback: params.remoteTokenFallback,
        remotePasswordFallback: params.remotePasswordFallback,
    };
    return resolveGatewayCredentialsWithEnv(context, params.env ?? process.env);
}
async function resolveGatewayTlsFingerprint(params) {
    const { opts, context, url } = params;
    const useLocalTls = context.config.gateway?.tls?.enabled === true &&
        !context.urlOverrideSource &&
        !context.remoteUrl &&
        url.startsWith("wss://");
    const tlsRuntime = useLocalTls
        ? await gatewayCallDeps.loadGatewayTlsRuntime(context.config.gateway?.tls)
        : undefined;
    const overrideTlsFingerprint = trimToUndefined(opts.tlsFingerprint);
    const remoteTlsFingerprint = 
    // Env overrides may still inherit configured remote TLS pinning for private cert deployments.
    // CLI overrides remain explicit-only and intentionally skip config remote TLS to avoid
    // accidentally pinning against caller-supplied target URLs.
    context.isRemoteMode && context.urlOverrideSource !== "cli"
        ? trimToUndefined(context.remote?.tlsFingerprint)
        : undefined;
    return (overrideTlsFingerprint ||
        remoteTlsFingerprint ||
        (tlsRuntime?.enabled ? tlsRuntime.fingerprintSha256 : undefined));
}
function formatGatewayCloseError(code, reason, connectionDetails) {
    const reasonText = reason?.trim() || "no close reason";
    const hint = code === 1006 ? "abnormal closure (no close frame)" : code === 1000 ? "normal closure" : "";
    const suffix = hint ? ` ${hint}` : "";
    return `gateway closed (${code}${suffix}): ${reasonText}\n${connectionDetails.message}`;
}
function formatGatewayTimeoutError(timeoutMs, connectionDetails) {
    return `gateway timeout after ${timeoutMs}ms\n${connectionDetails.message}`;
}
function ensureGatewaySupportsRequiredMethods(params) {
    const requiredMethods = Array.isArray(params.requiredMethods)
        ? params.requiredMethods.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
        : [];
    if (requiredMethods.length === 0) {
        return;
    }
    const supportedMethods = new Set((Array.isArray(params.methods) ? params.methods : [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0));
    for (const method of requiredMethods) {
        if (supportedMethods.has(method)) {
            continue;
        }
        throw new Error([
            `active gateway does not support required method "${method}" for "${params.attemptedMethod}".`,
            "Update the gateway or run without SecretRefs.",
        ].join(" "));
    }
}
async function executeGatewayRequestWithScopes(params) {
    const { opts, scopes, url, token, password, tlsFingerprint, timeoutMs, safeTimerTimeoutMs } = params;
    return await new Promise((resolve, reject) => {
        let settled = false;
        let ignoreClose = false;
        const stop = (err, value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (err) {
                reject(err);
            }
            else {
                resolve(value);
            }
        };
        const client = gatewayCallDeps.createGatewayClient({
            url,
            token,
            password,
            tlsFingerprint,
            instanceId: opts.instanceId ?? randomUUID(),
            clientName: opts.clientName ?? GATEWAY_CLIENT_NAMES.CLI,
            clientDisplayName: opts.clientDisplayName,
            clientVersion: opts.clientVersion ?? VERSION,
            platform: opts.platform,
            mode: opts.mode ?? GATEWAY_CLIENT_MODES.CLI,
            role: "operator",
            scopes,
            deviceIdentity: resolveDeviceIdentityForGatewayCall(),
            minProtocol: opts.minProtocol ?? PROTOCOL_VERSION,
            maxProtocol: opts.maxProtocol ?? PROTOCOL_VERSION,
            onHelloOk: async (hello) => {
                try {
                    ensureGatewaySupportsRequiredMethods({
                        requiredMethods: opts.requiredMethods,
                        methods: hello.features?.methods,
                        attemptedMethod: opts.method,
                    });
                    const result = await client.request(opts.method, opts.params, {
                        expectFinal: opts.expectFinal,
                        timeoutMs: opts.timeoutMs,
                    });
                    ignoreClose = true;
                    stop(undefined, result);
                    client.stop();
                }
                catch (err) {
                    ignoreClose = true;
                    client.stop();
                    stop(err);
                }
            },
            onClose: (code, reason) => {
                if (settled || ignoreClose) {
                    return;
                }
                ignoreClose = true;
                client.stop();
                stop(new Error(formatGatewayCloseError(code, reason, params.connectionDetails)));
            },
        });
        const timer = setTimeout(() => {
            ignoreClose = true;
            client.stop();
            stop(new Error(formatGatewayTimeoutError(timeoutMs, params.connectionDetails)));
        }, safeTimerTimeoutMs);
        client.start();
    });
}
async function callGatewayWithScopes(opts, scopes) {
    const { timeoutMs, safeTimerTimeoutMs } = resolveGatewayCallTimeout(opts.timeoutMs);
    const context = resolveGatewayCallContext(opts);
    const resolvedCredentials = await resolveGatewayCredentials(context);
    ensureExplicitGatewayAuth({
        urlOverride: context.urlOverride,
        urlOverrideSource: context.urlOverrideSource,
        explicitAuth: context.explicitAuth,
        resolvedAuth: resolvedCredentials,
        errorHint: "Fix: pass --token or --password (or gatewayToken in tools).",
        configPath: context.configPath,
    });
    ensureRemoteModeUrlConfigured(context);
    const connectionDetails = buildGatewayConnectionDetails({
        config: context.config,
        url: context.urlOverride,
        urlSource: context.urlOverrideSource,
        ...(opts.configPath ? { configPath: opts.configPath } : {}),
    });
    const url = connectionDetails.url;
    const tlsFingerprint = await resolveGatewayTlsFingerprint({ opts, context, url });
    const { token, password } = resolvedCredentials;
    return await executeGatewayRequestWithScopes({
        opts,
        scopes,
        url,
        token,
        password,
        tlsFingerprint,
        timeoutMs,
        safeTimerTimeoutMs,
        connectionDetails,
    });
}
export async function callGatewayScoped(opts) {
    return await callGatewayWithScopes(opts, opts.scopes);
}
export async function callGatewayCli(opts) {
    const scopes = Array.isArray(opts.scopes) ? opts.scopes : CLI_DEFAULT_OPERATOR_SCOPES;
    return await callGatewayWithScopes(opts, scopes);
}
export async function callGatewayLeastPrivilege(opts) {
    const scopes = resolveLeastPrivilegeOperatorScopesForMethod(opts.method);
    return await callGatewayWithScopes(opts, scopes);
}
export async function callGateway(opts) {
    if (Array.isArray(opts.scopes)) {
        return await callGatewayWithScopes(opts, opts.scopes);
    }
    const callerMode = opts.mode ?? GATEWAY_CLIENT_MODES.BACKEND;
    const callerName = opts.clientName ?? GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT;
    if (callerMode === GATEWAY_CLIENT_MODES.CLI || callerName === GATEWAY_CLIENT_NAMES.CLI) {
        return await callGatewayCli(opts);
    }
    return await callGatewayLeastPrivilege({
        ...opts,
        mode: callerMode,
        clientName: callerName,
    });
}
export function randomIdempotencyKey() {
    return randomUUID();
}
