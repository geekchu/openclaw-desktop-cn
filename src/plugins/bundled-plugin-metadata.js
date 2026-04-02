import fs from "node:fs";
import path from "node:path";
import { GENERATED_BUNDLED_PLUGIN_METADATA } from "./bundled-plugin-metadata.generated.js";
const PUBLIC_SURFACE_SOURCE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"];
export const BUNDLED_PLUGIN_METADATA = GENERATED_BUNDLED_PLUGIN_METADATA;
export function resolveBundledPluginGeneratedPath(rootDir, entry) {
    if (!entry) {
        return null;
    }
    const candidates = [entry.built, entry.source]
        .filter((candidate) => typeof candidate === "string" && candidate.length > 0)
        .map((candidate) => path.resolve(rootDir, candidate));
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
export function resolveBundledPluginPublicSurfacePath(params) {
    const artifactBasename = params.artifactBasename.replace(/^\.\//u, "");
    if (!artifactBasename) {
        return null;
    }
    const builtCandidate = path.resolve(params.rootDir, "dist", "extensions", params.dirName, artifactBasename);
    if (fs.existsSync(builtCandidate)) {
        return builtCandidate;
    }
    const sourceBaseName = artifactBasename.replace(/\.js$/u, "");
    for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
        const sourceCandidate = path.resolve(params.rootDir, "extensions", params.dirName, `${sourceBaseName}${ext}`);
        if (fs.existsSync(sourceCandidate)) {
            return sourceCandidate;
        }
    }
    return null;
}
