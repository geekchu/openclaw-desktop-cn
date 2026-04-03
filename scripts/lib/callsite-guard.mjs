import { promises as fs } from "node:fs";
import path from "node:path";
import {
  collectTypeScriptFilesFromRoots,
  resolveRepoRoot,
  resolveSourceRoots,
} from "./ts-guard-utils.mjs";

function normalizeRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

export async function runCallsiteGuard(params) {
  const repoRoot = resolveRepoRoot(params.importMetaUrl);
  const sourceRoots = resolveSourceRoots(repoRoot, params.sourceRoots ?? []);
  const files = await collectTypeScriptFilesFromRoots(sourceRoots, {
    extraTestSuffixes: params.extraTestSuffixes,
  });

  const callsites = new Set();
  for (const filePath of files) {
    const relativePath = normalizeRelativePath(repoRoot, filePath);
    if (params.skipRelativePath?.(relativePath)) {
      continue;
    }
    const content = await fs.readFile(filePath, "utf8");
    const lines = params.findCallLines(content, filePath) ?? [];
    for (const line of lines) {
      const callsite = `${relativePath}:${line}`;
      if (params.allowCallsite?.(callsite)) {
        continue;
      }
      callsites.add(callsite);
    }
  }

  if (callsites.size === 0) {
    return;
  }

  console.error(params.header);
  for (const callsite of [...callsites].toSorted((left, right) => left.localeCompare(right))) {
    console.error(`- ${callsite}`);
  }
  if (params.footer) {
    console.error(params.footer);
  }
  process.exitCode = 1;
}
