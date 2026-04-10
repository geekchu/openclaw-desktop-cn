#!/usr/bin/env node

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const runtimeDistSrc = join(projectRoot, "dist");
const bundleDistRoot = join(projectRoot, "src-tauri", "gateway-bundle", "dist");
const debugBundleDistRoot = join(
  projectRoot,
  "src-tauri",
  "target",
  "debug",
  "gateway-bundle",
  "dist",
);
const bundleOpenClawEntry = join(projectRoot, "src-tauri", "gateway-bundle", "openclaw.mjs");
const debugBundleOpenClawEntry = join(
  projectRoot,
  "src-tauri",
  "target",
  "debug",
  "gateway-bundle",
  "openclaw.mjs",
);
const rootOpenClawEntry = join(projectRoot, "openclaw.mjs");

function run(command) {
  console.log(`[tauri-dev] $ ${command}`);
  execSync(command, {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  });
}

function replaceDir(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`[tauri-dev] synced ${src} -> ${dest}`);
}

function copyFile(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { force: true });
  console.log(`[tauri-dev] synced ${src} -> ${dest}`);
}

run("pnpm build");
run("node scripts/ui.js build");

if (!existsSync(runtimeDistSrc)) {
  throw new Error(`Runtime build output missing: ${runtimeDistSrc}`);
}

mkdirSync(bundleDistRoot, { recursive: true });
replaceDir(runtimeDistSrc, bundleDistRoot);
copyFile(rootOpenClawEntry, bundleOpenClawEntry);

// Tauri debug runs may continue using the copied gateway bundle under target/debug,
// so refresh the full runtime dist there as well instead of only the UI subset.
mkdirSync(debugBundleDistRoot, { recursive: true });
replaceDir(runtimeDistSrc, debugBundleDistRoot);
copyFile(rootOpenClawEntry, debugBundleOpenClawEntry);
