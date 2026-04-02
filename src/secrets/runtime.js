import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import { listAgentIds, resolveAgentDir } from "../agents/agent-scope.js";
import { clearRuntimeAuthProfileStoreSnapshots, loadAuthProfileStoreForSecretsRuntime, replaceRuntimeAuthProfileStoreSnapshots, } from "../agents/auth-profiles.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshotRefreshHandler, setRuntimeConfigSnapshot, } from "../config/config.js";
import { migrateLegacyConfig } from "../config/legacy-migrate.js";
import { resolveUserPath } from "../utils.js";
import { collectCommandSecretAssignmentsFromSnapshot, } from "./command-config.js";
import { resolveSecretRefValues } from "./resolve.js";
import { collectAuthStoreAssignments } from "./runtime-auth-collectors.js";
import { collectConfigAssignments } from "./runtime-config-collectors.js";
import { applyResolvedAssignments, createResolverContext, } from "./runtime-shared.js";
import { resolveRuntimeWebTools } from "./runtime-web-tools.js";
const RUNTIME_PATH_ENV_KEYS = [
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "OPENCLAW_HOME",
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_CONFIG_PATH",
    "OPENCLAW_AGENT_DIR",
    "PI_CODING_AGENT_DIR",
    "OPENCLAW_TEST_FAST",
];
let activeSnapshot = null;
let activeRefreshContext = null;
const preparedSnapshotRefreshContext = new WeakMap();
function cloneSnapshot(snapshot) {
    return {
        sourceConfig: structuredClone(snapshot.sourceConfig),
        config: structuredClone(snapshot.config),
        authStores: snapshot.authStores.map((entry) => ({
            agentDir: entry.agentDir,
            store: structuredClone(entry.store),
        })),
        warnings: snapshot.warnings.map((warning) => ({ ...warning })),
        webTools: structuredClone(snapshot.webTools),
    };
}
function cloneRefreshContext(context) {
    return {
        env: { ...context.env },
        explicitAgentDirs: context.explicitAgentDirs ? [...context.explicitAgentDirs] : null,
        loadAuthStore: context.loadAuthStore,
    };
}
function clearActiveSecretsRuntimeState() {
    activeSnapshot = null;
    activeRefreshContext = null;
    setRuntimeConfigSnapshotRefreshHandler(null);
    clearRuntimeConfigSnapshot();
    clearRuntimeAuthProfileStoreSnapshots();
}
function collectCandidateAgentDirs(config, env = process.env) {
    const dirs = new Set();
    dirs.add(resolveUserPath(resolveOpenClawAgentDir(env), env));
    for (const agentId of listAgentIds(config)) {
        dirs.add(resolveUserPath(resolveAgentDir(config, agentId, env), env));
    }
    return [...dirs];
}
function resolveRefreshAgentDirs(config, context) {
    const configDerived = collectCandidateAgentDirs(config, context.env);
    if (!context.explicitAgentDirs || context.explicitAgentDirs.length === 0) {
        return configDerived;
    }
    return [...new Set([...context.explicitAgentDirs, ...configDerived])];
}
function mergeSecretsRuntimeEnv(env) {
    const merged = { ...(env ?? process.env) };
    for (const key of RUNTIME_PATH_ENV_KEYS) {
        if (merged[key] !== undefined) {
            continue;
        }
        const processValue = process.env[key];
        if (processValue !== undefined) {
            merged[key] = processValue;
        }
    }
    return merged;
}
export async function prepareSecretsRuntimeSnapshot(params) {
    const runtimeEnv = mergeSecretsRuntimeEnv(params.env);
    const sourceConfig = structuredClone(params.config);
    const resolvedConfig = structuredClone(migrateLegacyConfig(params.config).config ?? params.config);
    const context = createResolverContext({
        sourceConfig,
        env: runtimeEnv,
    });
    collectConfigAssignments({
        config: resolvedConfig,
        context,
    });
    const loadAuthStore = params.loadAuthStore ?? loadAuthProfileStoreForSecretsRuntime;
    const candidateDirs = params.agentDirs?.length
        ? [...new Set(params.agentDirs.map((entry) => resolveUserPath(entry, runtimeEnv)))]
        : collectCandidateAgentDirs(resolvedConfig, runtimeEnv);
    const authStores = [];
    for (const agentDir of candidateDirs) {
        const store = structuredClone(loadAuthStore(agentDir));
        collectAuthStoreAssignments({
            store,
            context,
            agentDir,
        });
        authStores.push({ agentDir, store });
    }
    if (context.assignments.length > 0) {
        const refs = context.assignments.map((assignment) => assignment.ref);
        const resolved = await resolveSecretRefValues(refs, {
            config: sourceConfig,
            env: context.env,
            cache: context.cache,
        });
        applyResolvedAssignments({
            assignments: context.assignments,
            resolved,
        });
    }
    const snapshot = {
        sourceConfig,
        config: resolvedConfig,
        authStores,
        warnings: context.warnings,
        webTools: await resolveRuntimeWebTools({
            sourceConfig,
            resolvedConfig,
            context,
        }),
    };
    preparedSnapshotRefreshContext.set(snapshot, {
        env: runtimeEnv,
        explicitAgentDirs: params.agentDirs?.length ? [...candidateDirs] : null,
        loadAuthStore,
    });
    return snapshot;
}
export function activateSecretsRuntimeSnapshot(snapshot) {
    const next = cloneSnapshot(snapshot);
    const refreshContext = preparedSnapshotRefreshContext.get(snapshot) ??
        activeRefreshContext ??
        {
            env: { ...process.env },
            explicitAgentDirs: null,
            loadAuthStore: loadAuthProfileStoreForSecretsRuntime,
        };
    setRuntimeConfigSnapshot(next.config, next.sourceConfig);
    replaceRuntimeAuthProfileStoreSnapshots(next.authStores);
    activeSnapshot = next;
    activeRefreshContext = cloneRefreshContext(refreshContext);
    setRuntimeConfigSnapshotRefreshHandler({
        refresh: async ({ sourceConfig }) => {
            if (!activeSnapshot || !activeRefreshContext) {
                return false;
            }
            const refreshed = await prepareSecretsRuntimeSnapshot({
                config: sourceConfig,
                env: activeRefreshContext.env,
                agentDirs: resolveRefreshAgentDirs(sourceConfig, activeRefreshContext),
                loadAuthStore: activeRefreshContext.loadAuthStore,
            });
            activateSecretsRuntimeSnapshot(refreshed);
            return true;
        },
    });
}
export function getActiveSecretsRuntimeSnapshot() {
    if (!activeSnapshot) {
        return null;
    }
    const snapshot = cloneSnapshot(activeSnapshot);
    if (activeRefreshContext) {
        preparedSnapshotRefreshContext.set(snapshot, cloneRefreshContext(activeRefreshContext));
    }
    return snapshot;
}
export function getActiveRuntimeWebToolsMetadata() {
    if (!activeSnapshot) {
        return null;
    }
    return structuredClone(activeSnapshot.webTools);
}
export function resolveCommandSecretsFromActiveRuntimeSnapshot(params) {
    if (!activeSnapshot) {
        throw new Error("Secrets runtime snapshot is not active.");
    }
    if (params.targetIds.size === 0) {
        return { assignments: [], diagnostics: [], inactiveRefPaths: [] };
    }
    const inactiveRefPaths = [
        ...new Set(activeSnapshot.warnings
            .filter((warning) => warning.code === "SECRETS_REF_IGNORED_INACTIVE_SURFACE")
            .map((warning) => warning.path)),
    ];
    const resolved = collectCommandSecretAssignmentsFromSnapshot({
        sourceConfig: activeSnapshot.sourceConfig,
        resolvedConfig: activeSnapshot.config,
        commandName: params.commandName,
        targetIds: params.targetIds,
        inactiveRefPaths: new Set(inactiveRefPaths),
    });
    return {
        assignments: resolved.assignments,
        diagnostics: resolved.diagnostics,
        inactiveRefPaths,
    };
}
export function clearSecretsRuntimeSnapshot() {
    clearActiveSecretsRuntimeState();
}
