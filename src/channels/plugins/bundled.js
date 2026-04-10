import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatErrorMessage } from "../../infra/errors.js";
import { resolveOpenClawPackageRootSync } from "../../infra/openclaw-root.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { listBundledChannelPluginMetadata, resolveBundledChannelGeneratedPath, } from "../../plugins/bundled-channel-runtime.js";
import { isJavaScriptModulePath, loadChannelPluginModule } from "./module-loader.js";
const log = createSubsystemLogger("channels");
const OPENCLAW_PACKAGE_ROOT = resolveOpenClawPackageRootSync({
    argv1: process.argv[1],
    cwd: process.cwd(),
    moduleUrl: import.meta.url.startsWith("file:") ? import.meta.url : undefined,
}) ??
    (import.meta.url.startsWith("file:")
        ? path.resolve(fileURLToPath(new URL("../../..", import.meta.url)))
        : process.cwd());
function resolveChannelPluginModuleEntry(moduleExport) {
    const resolved = moduleExport &&
        typeof moduleExport === "object" &&
        "default" in moduleExport
        ? moduleExport.default
        : moduleExport;
    if (!resolved || typeof resolved !== "object") {
        return null;
    }
    const record = resolved;
    if (record.kind !== "bundled-channel-entry") {
        return null;
    }
    if (typeof record.id !== "string" ||
        typeof record.name !== "string" ||
        typeof record.description !== "string" ||
        typeof record.register !== "function" ||
        typeof record.loadChannelPlugin !== "function") {
        return null;
    }
    return record;
}
function resolveChannelSetupModuleEntry(moduleExport) {
    const resolved = moduleExport &&
        typeof moduleExport === "object" &&
        "default" in moduleExport
        ? moduleExport.default
        : moduleExport;
    if (!resolved || typeof resolved !== "object") {
        return null;
    }
    const record = resolved;
    if (record.kind !== "bundled-channel-setup-entry") {
        return null;
    }
    if (typeof record.loadSetupPlugin !== "function") {
        return null;
    }
    return record;
}
function resolveBundledChannelBoundaryRoot(params) {
    const distRoot = path.resolve(OPENCLAW_PACKAGE_ROOT, "dist", "extensions", params.metadata.dirName);
    if (params.modulePath === distRoot || params.modulePath.startsWith(`${distRoot}${path.sep}`)) {
        return distRoot;
    }
    return path.resolve(OPENCLAW_PACKAGE_ROOT, "extensions", params.metadata.dirName);
}
function resolveGeneratedBundledChannelModulePath(params) {
    if (!params.entry) {
        return null;
    }
    const resolved = resolveBundledChannelGeneratedPath(OPENCLAW_PACKAGE_ROOT, params.entry, params.metadata.dirName);
    if (resolved) {
        return resolved;
    }
    return null;
}
function loadGeneratedBundledChannelModule(params) {
    const modulePath = resolveGeneratedBundledChannelModulePath(params);
    if (!modulePath) {
        throw new Error(`missing generated module for bundled channel ${params.metadata.manifest.id}`);
    }
    return loadChannelPluginModule({
        modulePath,
        rootDir: resolveBundledChannelBoundaryRoot({
            metadata: params.metadata,
            modulePath,
        }),
        boundaryRootDir: resolveBundledChannelBoundaryRoot({
            metadata: params.metadata,
            modulePath,
        }),
        shouldTryNativeRequire: (safePath) => safePath.includes(`${path.sep}dist${path.sep}`) && isJavaScriptModulePath(safePath),
    });
}
function loadGeneratedBundledChannelEntries() {
    const entries = [];
    for (const metadata of listBundledChannelPluginMetadata({
        includeChannelConfigs: false,
        includeSyntheticChannelConfigs: false,
    })) {
        if ((metadata.manifest.channels?.length ?? 0) === 0) {
            continue;
        }
        try {
            const entry = resolveChannelPluginModuleEntry(loadGeneratedBundledChannelModule({
                metadata,
                entry: metadata.source,
            }));
            if (!entry) {
                log.warn(`[channels] bundled channel entry ${metadata.manifest.id} missing bundled-channel-entry contract; skipping`);
                continue;
            }
            const setupEntry = metadata.setupSource
                ? resolveChannelSetupModuleEntry(loadGeneratedBundledChannelModule({
                    metadata,
                    entry: metadata.setupSource,
                }))
                : null;
            entries.push({
                id: metadata.manifest.id,
                entry,
                ...(setupEntry ? { setupEntry } : {}),
            });
        }
        catch (error) {
            const detail = formatErrorMessage(error);
            log.warn(`[channels] failed to load bundled channel ${metadata.manifest.id}: ${detail}`);
        }
    }
    return entries;
}
const EMPTY_BUNDLED_CHANNEL_STATE = {
    entries: [],
    entriesById: new Map(),
    setupEntriesById: new Map(),
    sortedIds: [],
    pluginsById: new Map(),
    setupPluginsById: new Map(),
    secretsById: new Map(),
    setupSecretsById: new Map(),
    runtimeSettersById: new Map(),
};
let cachedBundledChannelState = null;
let bundledChannelStateLoadInProgress = false;
const pluginLoadInProgressIds = new Set();
const setupPluginLoadInProgressIds = new Set();
function getBundledChannelState() {
    if (cachedBundledChannelState) {
        return cachedBundledChannelState;
    }
    if (bundledChannelStateLoadInProgress) {
        return EMPTY_BUNDLED_CHANNEL_STATE;
    }
    bundledChannelStateLoadInProgress = true;
    const entries = loadGeneratedBundledChannelEntries();
    const entriesById = new Map();
    const setupEntriesById = new Map();
    const runtimeSettersById = new Map();
    for (const { entry } of entries) {
        if (entriesById.has(entry.id)) {
            throw new Error(`duplicate bundled channel plugin id: ${entry.id}`);
        }
        entriesById.set(entry.id, entry);
        if (entry.setChannelRuntime) {
            runtimeSettersById.set(entry.id, entry.setChannelRuntime);
        }
    }
    for (const { id, setupEntry } of entries) {
        if (setupEntry) {
            setupEntriesById.set(id, setupEntry);
        }
    }
    try {
        cachedBundledChannelState = {
            entries,
            entriesById,
            setupEntriesById,
            sortedIds: [...entriesById.keys()].toSorted((left, right) => left.localeCompare(right)),
            pluginsById: new Map(),
            setupPluginsById: new Map(),
            secretsById: new Map(),
            setupSecretsById: new Map(),
            runtimeSettersById,
        };
        return cachedBundledChannelState;
    }
    finally {
        bundledChannelStateLoadInProgress = false;
    }
}
export function listBundledChannelPlugins() {
    const state = getBundledChannelState();
    return state.sortedIds.flatMap((id) => {
        const plugin = getBundledChannelPlugin(id);
        return plugin ? [plugin] : [];
    });
}
export function listBundledChannelSetupPlugins() {
    const state = getBundledChannelState();
    return state.sortedIds.flatMap((id) => {
        const plugin = getBundledChannelSetupPlugin(id);
        return plugin ? [plugin] : [];
    });
}
export function getBundledChannelPlugin(id) {
    const state = getBundledChannelState();
    const cached = state.pluginsById.get(id);
    if (cached) {
        return cached;
    }
    if (pluginLoadInProgressIds.has(id)) {
        return undefined;
    }
    const entry = state.entriesById.get(id);
    if (!entry) {
        return undefined;
    }
    pluginLoadInProgressIds.add(id);
    try {
        const plugin = entry.loadChannelPlugin();
        state.pluginsById.set(id, plugin);
        return plugin;
    }
    finally {
        pluginLoadInProgressIds.delete(id);
    }
}
export function getBundledChannelSecrets(id) {
    const state = getBundledChannelState();
    if (state.secretsById.has(id)) {
        return state.secretsById.get(id) ?? undefined;
    }
    const entry = state.entriesById.get(id);
    if (!entry) {
        return undefined;
    }
    const secrets = entry.loadChannelSecrets?.() ?? getBundledChannelPlugin(id)?.secrets;
    state.secretsById.set(id, secrets ?? null);
    return secrets;
}
export function getBundledChannelSetupPlugin(id) {
    const state = getBundledChannelState();
    const cached = state.setupPluginsById.get(id);
    if (cached) {
        return cached;
    }
    if (setupPluginLoadInProgressIds.has(id)) {
        return undefined;
    }
    const entry = state.setupEntriesById.get(id);
    if (!entry) {
        return undefined;
    }
    setupPluginLoadInProgressIds.add(id);
    try {
        const plugin = entry.loadSetupPlugin();
        state.setupPluginsById.set(id, plugin);
        return plugin;
    }
    finally {
        setupPluginLoadInProgressIds.delete(id);
    }
}
export function getBundledChannelSetupSecrets(id) {
    const state = getBundledChannelState();
    if (state.setupSecretsById.has(id)) {
        return state.setupSecretsById.get(id) ?? undefined;
    }
    const entry = state.setupEntriesById.get(id);
    if (!entry) {
        return undefined;
    }
    const secrets = entry.loadSetupSecrets?.() ?? getBundledChannelSetupPlugin(id)?.secrets;
    state.setupSecretsById.set(id, secrets ?? null);
    return secrets;
}
export function requireBundledChannelPlugin(id) {
    const plugin = getBundledChannelPlugin(id);
    if (!plugin) {
        throw new Error(`missing bundled channel plugin: ${id}`);
    }
    return plugin;
}
export function setBundledChannelRuntime(id, runtime) {
    const setter = getBundledChannelState().runtimeSettersById.get(id);
    if (!setter) {
        throw new Error(`missing bundled channel runtime setter: ${id}`);
    }
    setter(runtime);
}
