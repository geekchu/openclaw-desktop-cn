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
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    if (process.platform === "win32") {
      // cpSync triggers V8 heap corruption on Windows with pnpm symlink trees;
      // robocopy handles junctions/symlinks correctly, exit codes 0-7 = success.
      // /XD node_modules: skip node_modules to avoid circular pnpm symlinks
      mkdirSync(dest, { recursive: true });
      try {
        execSync(`robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS /NP /XD node_modules`, {
          stdio: "inherit",
        });
      } catch (err) {
        // robocopy exit codes: 0-7 = success (bitmask), >=8 = error
        if (err.status >= 8) throw err;
      }
    } else {
      cpSync(src, dest, { recursive: true });
    }
    return true;
  }
  console.log(`[bundle] 跳过（不存在）: ${src}`);
  return false;
}

// Step 0: 下载 Node.js 运行环境
console.log("\n[bundle] === Step 0: 准备 Node.js 运行环境 ===");
run("node scripts/download-node.js");

// Step 1: 编译 TypeScript
console.log("\n[bundle] === Step 1: 编译 TypeScript ===");
run("pnpm build");

// Step 2: 编译 Control UI
console.log("\n[bundle] === Step 2: 编译 Control UI ===");
run("pnpm ui:build");

// Step 2.5: 编译 Manager UI
console.log("\n[bundle] === Step 2.5: 编译 Manager UI ===");
run("pnpm manager:build");

// Step 2.6: 确保 splash.html 在 frontend 目录中
// Tauri 生产构建仅嵌入 frontendDist（./frontend）中的文件，
// 而 splash.html 源文件在 src-tauri/ 根目录，需要复制到 frontend/ 中
console.log("\n[bundle] === Step 2.6: 复制 splash.html 到 frontend ===");
const splashSrc = join(projectRoot, "src-tauri", "splash.html");
const frontendDir = join(projectRoot, "src-tauri", "frontend");
if (existsSync(splashSrc)) {
  mkdirSync(frontendDir, { recursive: true });
  cpSync(splashSrc, join(frontendDir, "splash.html"));
  console.log("[bundle] 已复制 splash.html → frontend/splash.html");
} else {
  console.warn("[bundle] 警告: splash.html 不存在，跳过");
}

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

// 复制 docs/reference/templates/ 目录（workspace 模板，如 AGENTS.md）
copyIfExists(
  join(projectRoot, "docs", "reference", "templates"),
  join(bundleDir, "docs", "reference", "templates"),
);

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

// Step 6: 安装 extension 依赖
console.log("\n[bundle] === Step 6: 安装 extension 依赖 ===");
const extDir = join(bundleDir, "extensions");
if (existsSync(extDir)) {
  for (const name of readdirSync(extDir)) {
    const extPkgPath = join(extDir, name, "package.json");
    if (!existsSync(extPkgPath)) continue;
    const extPkg = JSON.parse(readFileSync(extPkgPath, "utf-8"));
    const deps = extPkg.dependencies;
    if (!deps || Object.keys(deps).length === 0) continue;
    console.log(`[bundle] 安装 extension/${name} 依赖 (${Object.keys(deps).length} 个包)`);
    run("npm install --omit=dev --install-strategy=hoisted --ignore-scripts", {
      cwd: join(extDir, name),
    });
  }
}

console.log("\n[bundle] === 完成 ===");
console.log(`[bundle] Gateway bundle 已创建: ${bundleDir}`);
