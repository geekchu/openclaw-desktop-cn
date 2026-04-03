#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function runGit(args) {
  return spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

try {
  const workTree = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (workTree.error || workTree.status !== 0 || workTree.stdout.trim() !== "true") {
    process.exit(0);
  }

  const configureHooks = runGit(["config", "core.hooksPath", "git-hooks"]);
  if (configureHooks.error || configureHooks.status !== 0) {
    process.exit(0);
  }
} catch {
  process.exit(0);
}
