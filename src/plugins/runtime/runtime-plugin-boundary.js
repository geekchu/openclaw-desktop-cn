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
        ...(pluginSdkAlias ? { "openclaw/plugin-sdk": pluginSdkAlias } : {}),
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
