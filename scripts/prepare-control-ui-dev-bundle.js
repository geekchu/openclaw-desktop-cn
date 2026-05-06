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

// Build ClawPanel
const clawPanelWebDir = join(projectRoot, "ClawPanel", "web");
if (existsSync(clawPanelWebDir)) {
  console.log("[tauri-dev] Building ClawPanel...");
  if (!existsSync(join(clawPanelWebDir, "node_modules"))) {
    console.log("[tauri-dev] $ npm install (ClawPanel)");
    execSync("npm install", { cwd: clawPanelWebDir, stdio: "inherit", windowsHide: true });
  }
  console.log("[tauri-dev] $ npx vite build (ClawPanel)");
  execSync("npx vite build", { cwd: clawPanelWebDir, stdio: "inherit", windowsHide: true });
} else {
  console.log("[tauri-dev] ClawPanel not found, skipping");
}

if (!existsSync(runtimeDistSrc)) {
  throw new Error(`Runtime build output missing: ${runtimeDistSrc}`);
}

mkdirSync(bundleDistRoot, { recursive: true });
replaceDir(runtimeDistSrc, bundleDistRoot);
copyFile(rootOpenClawEntry, bundleOpenClawEntry);

// Copy ClawPanel build output into control-ui
const clawPanelDist = join(clawPanelWebDir, "dist");
if (existsSync(clawPanelDist)) {
  const clawPanelTarget = join(bundleDistRoot, "control-ui", "clawpanel");
  replaceDir(clawPanelDist, clawPanelTarget);
}

// Tauri debug runs may continue using the copied gateway bundle under target/debug,
// so refresh the full runtime dist there as well instead of only the UI subset.
mkdirSync(debugBundleDistRoot, { recursive: true });
replaceDir(runtimeDistSrc, debugBundleDistRoot);
copyFile(rootOpenClawEntry, debugBundleOpenClawEntry);

// Copy ClawPanel into debug bundle too
if (existsSync(clawPanelDist)) {
  const clawPanelDebugTarget = join(debugBundleDistRoot, "control-ui", "clawpanel");
  replaceDir(clawPanelDist, clawPanelDebugTarget);
}
