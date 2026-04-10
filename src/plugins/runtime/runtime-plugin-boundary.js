import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { loadConfig } from "../../config/config.js";
import { loadPluginManifestRegistry } from "../manifest-registry.js";
import { buildPluginLoaderJitiOptions, resolvePluginSdkAliasFile, resolvePluginSdkScopedAliasMap, shouldPreferNativeJiti, } from "../sdk-alias.js";
export function readPluginBoundaryConfigSafely() {
    try {
        return loadConfig();
    }
    catch {
        return {};
    }
}
export function resolvePluginRuntimeRecord(pluginId, onMissing) {
    const manifestRegistry = loadPluginManifestRegistry({
        config: readPluginBoundaryConfigSafely(),
        cache: true,
    });
    const record = manifestRegistry.plugins.find((plugin) => plugin.id === pluginId);
    if (!record?.source) {
        if (onMissing) {
            onMissing();
        }
        return null;
    }
    return {
        ...(record.origin ? { origin: record.origin } : {}),
        rootDir: record.rootDir,
        source: record.source,
    };
}
export function resolvePluginRuntimeRecordByEntryBaseNames(entryBaseNames, onMissing) {
    const manifestRegistry = loadPluginManifestRegistry({
        config: readPluginBoundaryConfigSafely(),
        cache: true,
    });
    const matches = manifestRegistry.plugins.filter((plugin) => {
        if (!plugin?.source) {
            return false;
        }
        const record = {
            rootDir: plugin.rootDir,
            source: plugin.source,
        };
        return entryBaseNames.every((entryBaseName) => resolvePluginRuntimeModulePath(record, entryBaseName) !== null);
    });
    if (matches.length === 0) {
        if (onMissing) {
            onMissing();
        }
        return null;
    }
    if (matches.length > 1) {
        const pluginIds = matches.map((plugin) => plugin.id).join(", ");
        throw new Error(`plugin runtime boundary is ambiguous for entries [${entryBaseNames.join(", ")}]: ${pluginIds}`);
    }
    const record = matches[0];
    return {
        ...(record.origin ? { origin: record.origin } : {}),
        rootDir: record.rootDir,
        source: record.source,
    };
}
export function resolvePluginRuntimeModulePath(record, entryBaseName, onMissing) {
    const candidates = [
        path.join(path.dirname(record.source), `${entryBaseName}.js`),
        path.join(path.dirname(record.source), `${entryBaseName}.ts`),
        ...(record.rootDir
            ? [
                path.join(record.rootDir, `${entryBaseName}.js`),
                path.join(record.rootDir, `${entryBaseName}.ts`),
            ]
            : []),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    if (onMissing) {
        onMissing();
    }
    return null;
}
export function getPluginBoundaryJiti(modulePath, loaders) {
    const tryNative = shouldPreferNativeJiti(modulePath);
    const cached = loaders.get(tryNative);
    if (cached) {
        return cached;
    }
    const pluginSdkAlias = resolvePluginSdkAliasFile({
        srcFile: "root-alias.cjs",
        distFile: "root-alias.cjs",
        modulePath,
    });
    const aliasMap = {
        ...(pluginSdkAlias
            ? {
                "openclaw/plugin-sdk": pluginSdkAlias,
                "@openclaw/plugin-sdk": pluginSdkAlias,
            }
            : {}),
        ...resolvePluginSdkScopedAliasMap({ modulePath }),
    };
    const loader = createJiti(import.meta.url, {
        ...buildPluginLoaderJitiOptions(aliasMap),
        tryNative,
    });
    loaders.set(tryNative, loader);
    return loader;
}
export function loadPluginBoundaryModuleWithJiti(modulePath, loaders) {
    return getPluginBoundaryJiti(modulePath, loaders)(modulePath);
}
export function createCachedPluginBoundaryModuleLoader(params) {
    let cachedModulePath = null;
    let cachedModule = null;
    const loaders = new Map();
    return () => {
        const missingLabel = params.missingLabel ?? `${params.pluginId} plugin runtime`;
        const record = resolvePluginRuntimeRecord(params.pluginId, params.required
            ? () => {
                throw new Error(`${missingLabel} is unavailable: missing plugin '${params.pluginId}'`);
            }
            : undefined);
        if (!record) {
            return null;
        }
        const modulePath = resolvePluginRuntimeModulePath(record, params.entryBaseName, params.required
            ? () => {
                throw new Error(`${missingLabel} is unavailable: missing ${params.entryBaseName} for plugin '${params.pluginId}'`);
            }
            : undefined);
        if (!modulePath) {
            return null;
        }
        if (cachedModule && cachedModulePath === modulePath) {
            return cachedModule;
        }
        const loaded = loadPluginBoundaryModuleWithJiti(modulePath, loaders);
        cachedModulePath = modulePath;
        cachedModule = loaded;
        return loaded;
    };
}
