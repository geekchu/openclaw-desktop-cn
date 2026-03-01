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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
      // /XD: skip node_modules (circular pnpm symlinks), .git, .github, test dirs
      // /XF: skip git metadata files
      mkdirSync(dest, { recursive: true });
      try {
        execSync(
          `robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git .github __tests__ test .nyc_output /XF .gitignore .gitattributes .npmignore`,
          {
            stdio: "inherit",
          },
        );
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

// Step 0.5: 精简 Node.js 运行环境（只删除文档文件）
console.log("\n[bundle] === Step 0.5: 精简 Node.js 运行环境 ===");
{
  const nodeRuntimeDir = join(projectRoot, "src-tauri", "node-runtime");
  if (existsSync(nodeRuntimeDir)) {
    for (const platform of readdirSync(nodeRuntimeDir)) {
      const platDir = join(nodeRuntimeDir, platform);
      if (!existsSync(platDir) || platform.startsWith(".")) {
        continue;
      }
      for (const f of ["CHANGELOG.md", "README.md", "LICENSE"]) {
        const fp = join(platDir, f);
        if (existsSync(fp)) {
          rmSync(fp, { force: true });
        }
      }
    }
  }
}

// Step 1: 编译 TypeScript
console.log("\n[bundle] === Step 1: 编译 TypeScript ===");
run("pnpm build");

// Step 2: 编译 Control UI
console.log("\n[bundle] === Step 2: 编译 Control UI ===");
run("pnpm ui:build");

// Step 2.5: Manager UI 已废弃，使用原生 Lit 组件替代，跳过
console.log("\n[bundle] === Step 2.5: 跳过 Manager UI（已由原生 Lit 组件替代）===");

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
// npm 不支持 pnpm 的 workspace: 协议，过滤掉这些依赖
const filteredDeps = {};
for (const [name, version] of Object.entries(rootPkg.dependencies || {})) {
  if (typeof version === "string" && version.startsWith("workspace:")) {
    console.log(`[bundle] 跳过 workspace 依赖: ${name}@${version}`);
    continue;
  }
  filteredDeps[name] = version;
}
const bundlePkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  type: "module",
  main: "dist/index.js",
  dependencies: filteredDeps,
};
writeFileSync(join(bundleDir, "package.json"), JSON.stringify(bundlePkg, null, 2));
console.log("[bundle] 创建 package.json（仅 dependencies，已过滤 workspace 协议）");

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
    // 过滤掉 workspace: 协议依赖
    const extFilteredDeps = {};
    let skipped = 0;
    for (const [depName, depVer] of Object.entries(deps)) {
      if (typeof depVer === "string" && depVer.startsWith("workspace:")) {
        console.log(`[bundle] 跳过 extension/${name} workspace 依赖: ${depName}@${depVer}`);
        skipped++;
        continue;
      }
      extFilteredDeps[depName] = depVer;
    }
    if (Object.keys(extFilteredDeps).length === 0) {
      console.log(`[bundle] extension/${name} 所有依赖均为 workspace 依赖，跳过安装`);
      continue;
    }
    // 回写过滤后的 package.json（同时删除含 workspace: 的 devDependencies）
    const devDeps = extPkg.devDependencies;
    let hasWorkspaceDev = false;
    if (devDeps) {
      for (const v of Object.values(devDeps)) {
        if (typeof v === "string" && v.startsWith("workspace:")) {
          hasWorkspaceDev = true;
          break;
        }
      }
    }
    if (skipped > 0 || hasWorkspaceDev) {
      extPkg.dependencies = extFilteredDeps;
      if (hasWorkspaceDev) delete extPkg.devDependencies;
      writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2));
    }
    console.log(
      `[bundle] 安装 extension/${name} 依赖 (${Object.keys(extFilteredDeps).length} 个包)`,
    );
    run("npm install --omit=dev --install-strategy=hoisted --ignore-scripts", {
      cwd: join(extDir, name),
    });
  }
}

// Step 6.5: 去重 — 删除 extension 中已存在于顶层 node_modules 的重复包
// Node.js 模块解析会向上遍历目录，extension 代码能找到 gateway-bundle/node_modules/ 中的包
console.log("\n[bundle] === Step 6.5: 去重 extension node_modules ===");
{
  const topNodeModules = join(bundleDir, "node_modules");
  if (existsSync(extDir) && existsSync(topNodeModules)) {
    let totalRemoved = 0;
    let savedBytes = 0;

    for (const extName of readdirSync(extDir)) {
      const extNM = join(extDir, extName, "node_modules");
      if (!existsSync(extNM)) continue;

      let extRemoved = 0;
      for (const pkg of readdirSync(extNM)) {
        // 跳过 .bin / .package-lock.json 等 npm 内部文件
        if (pkg.startsWith(".")) {
          continue;
        }

        // 比较两个目录下的 package.json version 的主版本号是否一致
        function canDedup(extPkgDir, topPkgDir) {
          try {
            const extVer =
              JSON.parse(readFileSync(join(extPkgDir, "package.json"), "utf-8")).version || "";
            const topVer =
              JSON.parse(readFileSync(join(topPkgDir, "package.json"), "utf-8")).version || "";
            // 主版本号一致才去重，避免大版本不兼容
            return extVer.split(".")[0] === topVer.split(".")[0];
          } catch {
            // 读不到 package.json 则保守不去重
            return false;
          }
        }

        // 处理 scoped 包（@scope/name）
        if (pkg.startsWith("@")) {
          const scopeDir = join(extNM, pkg);
          if (!existsSync(join(topNodeModules, pkg))) {
            continue;
          }
          for (const scopedPkg of readdirSync(scopeDir)) {
            const topPkgDir = join(topNodeModules, pkg, scopedPkg);
            if (existsSync(topPkgDir)) {
              const pkgDir = join(scopeDir, scopedPkg);
              if (!canDedup(pkgDir, topPkgDir)) {
                continue;
              }
              try {
                const stat = execSync(`du -sb "${pkgDir}" 2>/dev/null || echo "0"`, {
                  encoding: "utf-8",
                });
                savedBytes += parseInt(stat.split("\t")[0]) || 0;
              } catch {
                /* ignore */
              }
              rmSync(pkgDir, { recursive: true, force: true });
              extRemoved++;
            }
          }
          // 如果 scope 目录为空，删除它
          try {
            if (readdirSync(scopeDir).length === 0) {
              rmSync(scopeDir, { recursive: true, force: true });
            }
          } catch {
            /* ignore */
          }
        } else if (existsSync(join(topNodeModules, pkg))) {
          const pkgDir = join(extNM, pkg);
          if (!canDedup(pkgDir, join(topNodeModules, pkg))) {
            continue;
          }
          try {
            const stat = execSync(`du -sb "${pkgDir}" 2>/dev/null || echo "0"`, {
              encoding: "utf-8",
            });
            savedBytes += parseInt(stat.split("\t")[0]) || 0;
          } catch {
            /* ignore */
          }
          rmSync(pkgDir, { recursive: true, force: true });
          extRemoved++;
        }
      }
      // 如果 node_modules 为空，删除它
      try {
        if (readdirSync(extNM).length === 0) {
          rmSync(extNM, { recursive: true, force: true });
        }
      } catch {
        /* ignore */
      }

      if (extRemoved > 0) {
        console.log(`[bundle] extension/${extName}: 去重 ${extRemoved} 个包`);
        totalRemoved += extRemoved;
      }
    }

    const savedMB = (savedBytes / (1024 * 1024)).toFixed(0);
    console.log(`[bundle] 共去重 ${totalRemoved} 个包，节省约 ${savedMB} MB`);
  }
}

// Step 6.6: 删除桌面版不需要的重量级包
// 这些包不在顶层 node_modules 中，无法被 Step 6.5 去重
console.log("\n[bundle] === Step 6.6: 删除桌面版不需要的重量级包 ===");
{
  // 桌面版通过 API 接入模型，不需要本地推理引擎
  // typescript / @types / bun-types 是开发工具，运行时不需要
  // Node.js 22 已内置 Web Streams，不需要 polyfill
  const heavyPkgsToRemove = [
    "@node-llama-cpp", // 本地 LLM 推理引擎 (~681MB)
    "node-llama-cpp", // 本地 LLM (~33MB)
    "typescript", // 开发工具 (~23MB)
    "chromium-bidi", // 浏览器调试协议 (~19MB)
    "web-streams-polyfill", // Node 22 已内置 (~8.8MB)
    "discord-api-types", // 仅类型定义 (~5.1MB)
    "bun-types", // Bun 运行时类型 (~3.2MB)
    "@types", // TypeScript 类型声明 (~2.8MB)
    "@anthropic-ai/bedrock-sdk", // AWS Bedrock SDK（桌面版直接用 API）
  ];

  let heavyRemoved = 0;
  function removeHeavyPkgs(nmDir) {
    if (!existsSync(nmDir)) {
      return;
    }
    for (const pkg of heavyPkgsToRemove) {
      const pkgPath = join(nmDir, pkg);
      if (existsSync(pkgPath)) {
        rmSync(pkgPath, { recursive: true, force: true });
        console.log(`[bundle] 删除 ${pkgPath.replace(bundleDir, ".")}`);
        heavyRemoved++;
      }
    }
  }

  // 清理顶层 node_modules
  removeHeavyPkgs(join(bundleDir, "node_modules"));
  // 清理所有 extension 的 node_modules
  if (existsSync(extDir)) {
    for (const name of readdirSync(extDir)) {
      removeHeavyPkgs(join(extDir, name, "node_modules"));
    }
  }
  console.log(`[bundle] 共删除 ${heavyRemoved} 个重量级包`);
}

// Step 7: 清理不必要的文件（减小安装包体积）
console.log("\n[bundle] === Step 7: 清理不必要的文件 ===");
{
  // 注意：不要在此列表中加 "docs"，因为 gateway-bundle 自身有 docs/reference/templates/
  const dirsToRemove = new Set([
    ".git",
    ".github",
    "__tests__",
    "test",
    "tests",
    ".nyc_output",
    "doc",
    "example",
    "examples",
    "coverage",
  ]);
  const filesToRemove = new Set([
    ".gitignore",
    ".gitattributes",
    ".npmignore",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "HISTORY.md",
    "README.md",
    "README.markdown",
    "readme.md",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".prettierrc",
    ".prettierrc.js",
    "tsconfig.json",
    "tsconfig.build.json",
    ".travis.yml",
    ".editorconfig",
    "Makefile",
    "Gruntfile.js",
    "Gulpfile.js",
    "karma.conf.js",
    "jest.config.js",
    "jest.config.ts",
  ]);
  // 注意：.d.ts 等复合扩展名无法通过 lastIndexOf(".") 匹配，
  // 所以这里只放单段扩展名，复合扩展名通过 endsWith 判断
  const extsToRemove = new Set([".map"]);

  let removedCount = 0;

  function cleanDir(dir, depth = 0) {
    if (!existsSync(dir) || depth > 15) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dirsToRemove.has(entry.name)) {
          rmSync(fullPath, { recursive: true, force: true });
          removedCount++;
        } else {
          cleanDir(fullPath, depth + 1);
        }
      } else {
        const shouldRemove =
          filesToRemove.has(entry.name) ||
          extsToRemove.has(entry.name.slice(entry.name.lastIndexOf("."))) ||
          entry.name.endsWith(".d.ts") ||
          entry.name.endsWith(".d.mts") ||
          entry.name.endsWith(".d.cts") ||
          entry.name.endsWith(".js.map") ||
          entry.name.endsWith(".ts.map") ||
          entry.name.endsWith(".mjs.map");
        if (shouldRemove) {
          rmSync(fullPath, { force: true });
          removedCount++;
        }
      }
    }
  }

  cleanDir(bundleDir);

  // 删除 extension 中的 src/ 目录（如果已有 dist/ 则不需要源码）
  if (existsSync(extDir)) {
    for (const name of readdirSync(extDir)) {
      const extPath = join(extDir, name);
      const hasDist = existsSync(join(extPath, "dist"));
      const hasSrc = existsSync(join(extPath, "src"));
      if (hasDist && hasSrc) {
        rmSync(join(extPath, "src"), { recursive: true, force: true });
        console.log(`[bundle] 删除 extension/${name}/src（已有 dist）`);
        removedCount++;
      }
      // 删除 tsconfig 等开发文件
      for (const devFile of ["tsconfig.json", "tsconfig.build.json", ".eslintrc.json"]) {
        const devPath = join(extPath, devFile);
        if (existsSync(devPath)) {
          rmSync(devPath, { force: true });
          removedCount++;
        }
      }
    }
  }

  console.log(`[bundle] 清理了 ${removedCount} 个不必要的文件/目录`);
}

// 显示最终 bundle 大小
try {
  const result = execSync(`du -sh "${bundleDir}"`, { encoding: "utf-8" }).trim();
  console.log(`[bundle] Bundle 大小: ${result.split("\t")[0]}`);
} catch {
  /* du not available on all platforms */
}

console.log("\n[bundle] === 完成 ===");
console.log(`[bundle] Gateway bundle 已创建: ${bundleDir}`);
