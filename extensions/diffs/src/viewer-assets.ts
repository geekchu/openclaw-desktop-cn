import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VIEWER_ASSET_PREFIX = "/plugins/diffs/assets/";
export const VIEWER_LOADER_PATH = `${VIEWER_ASSET_PREFIX}viewer.js`;
export const VIEWER_RUNTIME_PATH = `${VIEWER_ASSET_PREFIX}viewer-runtime.js`;

export type ServedViewerAsset = {
  body: string | Buffer;
  contentType: string;
};

type RuntimeAssetCache = {
  runtimePath: string;
  mtimeMs: number;
  runtimeBody: Buffer;
  loaderBody: string;
};

let runtimeAssetCache: RuntimeAssetCache | null = null;

export function buildViewerRuntimePathCandidates(
  moduleUrl = import.meta.url,
  cwd = process.cwd(),
): string[] {
  return Array.from(
    new Set([
      fileURLToPath(new URL("../assets/viewer-runtime.js", moduleUrl)),
      path.join(cwd, "extensions", "diffs", "assets", "viewer-runtime.js"),
    ]),
  );
}

export async function getServedViewerAsset(pathname: string): Promise<ServedViewerAsset | null> {
  if (pathname !== VIEWER_LOADER_PATH && pathname !== VIEWER_RUNTIME_PATH) {
    return null;
  }

  const assets = await loadViewerAssets();
  if (pathname === VIEWER_LOADER_PATH) {
    return {
      body: assets.loaderBody,
      contentType: "text/javascript; charset=utf-8",
    };
  }

  if (pathname === VIEWER_RUNTIME_PATH) {
    return {
      body: assets.runtimeBody,
      contentType: "text/javascript; charset=utf-8",
    };
  }

  return null;
}

async function loadViewerAssets(): Promise<RuntimeAssetCache> {
  let runtimePath: string | null = null;
  let runtimeStat: Awaited<ReturnType<typeof fs.stat>> | null = null;
  let lastError: unknown = null;
  for (const candidate of buildViewerRuntimePathCandidates()) {
    try {
      const stat = await fs.stat(candidate);
      runtimePath = candidate;
      runtimeStat = stat;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!runtimePath || !runtimeStat) {
    throw new Error(
      `diffs viewer runtime asset not found in any expected location: ${buildViewerRuntimePathCandidates().join(", ")}`,
      { cause: lastError },
    );
  }

  if (
    runtimeAssetCache &&
    runtimeAssetCache.runtimePath === runtimePath &&
    runtimeAssetCache.mtimeMs === runtimeStat.mtimeMs
  ) {
    return runtimeAssetCache;
  }

  const runtimeBody = await fs.readFile(runtimePath);
  const hash = crypto.createHash("sha1").update(runtimeBody).digest("hex").slice(0, 12);
  runtimeAssetCache = {
    runtimePath,
    mtimeMs: runtimeStat.mtimeMs,
    runtimeBody,
    loaderBody: `import "${VIEWER_RUNTIME_PATH}?v=${hash}";\n`,
  };
  return runtimeAssetCache;
}
