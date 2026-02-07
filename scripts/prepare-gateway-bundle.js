#!/usr/bin/env node

/**
 * prepare-gateway-bundle.js
 *
 * 为 Tauri 生产构建准备 gateway bundle。
 * 在 `cargo tauri build` 的 beforeBuildCommand 中运行。
 *
 * 步骤：
 * 1. 编译 TypeScript（pnpm build）
 * 2. 编译 Control UI（pnpm ui:build）
 * 3. 创建 src-tauri/gateway-bundle/ 目录
 * 4. 复制必要文件：openclaw.mjs, package.json, dist/, assets/, skills/
 * 5. 在 gateway-bundle/ 中运行 npm install --omit=dev 生成平铺的 node_modules/
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const bundleDir = join(projectRoot, "src-tauri", "gateway-bundle");

function run(cmd, opts = {}) {
  console.log(`[bundle] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: projectRoot, ...opts });
}

function copyIfExists(src, dest) {
  if (existsSync(src)) {
    console.log(`[bundle] 复制 ${src} → ${dest}`);
    cpSync(src, dest, { recursive: true });
    return true;
  }
  console.log(`[bundle] 跳过（不存在）: ${src}`);
  return false;
}

// Step 1: 编译 TypeScript
console.log("\n[bundle] === Step 1: 编译 TypeScript ===");
run("pnpm build");

// Step 2: 编译 Control UI
console.log("\n[bundle] === Step 2: 编译 Control UI ===");
run("pnpm ui:build");

// Step 2.5: 编译 Manager UI
console.log("\n[bundle] === Step 2.5: 编译 Manager UI ===");
run("pnpm manager:build");

// Step 3: 清理并创建 bundle 目录
console.log("\n[bundle] === Step 3: 创建 gateway-bundle ===");
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
}
mkdirSync(bundleDir, { recursive: true });

// Step 4: 复制文件
console.log("\n[bundle] === Step 4: 复制文件 ===");

// 入口文件
cpSync(join(projectRoot, "openclaw.mjs"), join(bundleDir, "openclaw.mjs"));
console.log("[bundle] 复制 openclaw.mjs");

// 复制 dist/ 目录
copyIfExists(join(projectRoot, "dist"), join(bundleDir, "dist"));

// 复制 assets/ 目录
copyIfExists(join(projectRoot, "assets"), join(bundleDir, "assets"));

// 复制 skills/ 目录
copyIfExists(join(projectRoot, "skills"), join(bundleDir, "skills"));

// 复制 extensions/ 目录
copyIfExists(join(projectRoot, "extensions"), join(bundleDir, "extensions"));

// 创建精简的 package.json（只保留 dependencies）
const rootPkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
const bundlePkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  type: "module",
  main: "dist/index.js",
  dependencies: rootPkg.dependencies || {},
};
writeFileSync(join(bundleDir, "package.json"), JSON.stringify(bundlePkg, null, 2));
console.log("[bundle] 创建 package.json（仅 dependencies）");

// Step 5: 安装依赖（平铺模式，不使用 pnpm 符号链接）
console.log("\n[bundle] === Step 5: 安装生产依赖 ===");
run("npm install --omit=dev --install-strategy=hoisted --ignore-scripts", { cwd: bundleDir });

console.log("\n[bundle] === 完成 ===");
console.log(`[bundle] Gateway bundle 已创建: ${bundleDir}`);
