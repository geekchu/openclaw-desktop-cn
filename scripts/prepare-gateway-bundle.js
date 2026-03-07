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

// Windows: cargo tauri build 的子进程可能丢失用户 PATH，导致找不到 pnpm/bash 等工具。
// 从系统环境变量重新拼接完整 PATH 以确保工具可用。
if (process.platform === "win32") {
  try {
    const fullPath = execSync(
      "powershell -NoProfile -Command \"[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')\"",
      { encoding: "utf-8", windowsHide: true },
    ).trim();
    if (fullPath) {
      // 合并：原始 PATH 优先，再追加系统环境变量中缺失的条目
      const origParts = process.env.PATH.split(";").filter(Boolean);
      const origLower = new Set(origParts.map((p) => p.toLowerCase()));
      const newParts = fullPath.split(";").filter(Boolean);
      for (const p of newParts) {
        if (!origLower.has(p.toLowerCase())) {
          origParts.push(p);
        }
      }
      process.env.PATH = origParts.join(";");
    }
  } catch {
    // ignore — keep existing PATH
  }

  // 确保当前 node 可执行文件的目录在 PATH 最前面。
  const nodeDir = dirname(process.execPath);
  if (!process.env.PATH.split(";").some((p) => p.toLowerCase() === nodeDir.toLowerCase())) {
    process.env.PATH = `${nodeDir};${process.env.PATH}`;
  }

  // 确保 Git for Windows 的 bash 路径在 WSL bash (C:\Windows\System32\bash.exe) 之前。
  // pnpm 运行 "bash scripts/..." 时会搜索 PATH，如果先找到 WSL bash，
  // 脚本会在 WSL 环境中执行，导致 node 等工具不可用。
  const gitBashCandidates = [
    "C:\\Program Files\\Git\\usr\\bin",
    "C:\\Program Files\\Git\\bin",
    "C:\\Program Files (x86)\\Git\\usr\\bin",
    "C:\\Program Files (x86)\\Git\\bin",
  ];
  const gitBashDir = gitBashCandidates.find((d) => existsSync(join(d, "bash.exe")));
  if (gitBashDir) {
    const parts = process.env.PATH.split(";").filter(Boolean);
    const lowerGit = gitBashDir.toLowerCase();
    // 移除已有的同路径条目，然后插到最前面
    const filtered = parts.filter((p) => p.toLowerCase() !== lowerGit);
    process.env.PATH = `${gitBashDir};${filtered.join(";")}`;
  }
}

function run(cmd, opts = {}) {
  console.log(`[bundle] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: projectRoot, windowsHide: true, ...opts });
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
            windowsHide: true,
          },
        );
      } catch (err) {
        // robocopy exit codes: 0-7 = success (bitmask), >=8 = error
        if (err.status >= 8) {
          throw err;
        }
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

if (process.env.BUILD_CONFIG === "release") {
  console.log("\n[bundle] === DETECTED RELEASE CONFIG: Running ESBuild Single-File Optimizer ===");
  run("node scripts/build-gateway-bundle.mjs");
  process.exit(0);
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

// [FIX] 很多 extension 源码（特别是未编译直接由 jiti 运行的 .ts 文件，如 twitch, llm-task）
// 会直接引用 ../../../src/...，但在生产 target bundle 中 src/ 被剔除，导致 Cannot find module 崩溃。
// 我们在打包阶段将这些引用原地替换为 ../../../dist/... 来劫持到已编译的安全产物。
{
  function rewriteSrcToDist(dir) {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        rewriteSrcToDist(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
        const content = readFileSync(fullPath, "utf-8");
        let replaced = content;

        // 特殊处理 twitch 扩展：它引用了未公开的 session-key.js
        replaced = replaced.replace(
          /(['"])\.\.\/\.\.\/\.\.\/src\/routing\/session-key\.js(['"])/g,
          "$1openclaw/plugin-sdk/account-id$2",
        );

        // 特殊处理 llm-task/lobster 扩展：它们动态引入 pi-embedded-runner
        replaced = replaced.replace(
          /(['"])\.\.\/\.\.\/\.\.\/src\/agents\/pi-embedded-runner\.js(['"])/g,
          "$1openclaw/dist/extensionAPI.js$2",
        );

        // TypeScript 会擦除只包含 type 的 import，但以防万一直接映射到 dist/
        replaced = replaced.replace(/(['"])\.\.\/\.\.\/\.\.\/src\//g, "$1../../../dist/");

        if (content !== replaced) {
          writeFileSync(fullPath, replaced, "utf-8");
        }
      }
    }
  }
  rewriteSrcToDist(join(bundleDir, "extensions"));
}

// 复制 docs/reference/templates/ 目录（workspace 模板，如 AGENTS.md）
copyIfExists(
  join(projectRoot, "docs", "reference", "templates"),
  join(bundleDir, "docs", "reference", "templates"),
);

// 创建精简的 package.json（合并根依赖 + 所有 extension 依赖）
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

// 合并所有 extension 的 dependencies 到根 package.json
// 这样只需一次 npm install，所有包统一安装到 gateway-bundle/node_modules/
// Node.js 模块解析会从 extension 目录向上遍历到 gateway-bundle/node_modules/
const extDir = join(bundleDir, "extensions");
if (existsSync(extDir)) {
  for (const name of readdirSync(extDir)) {
    const extPkgPath = join(extDir, name, "package.json");
    if (!existsSync(extPkgPath)) {
      continue;
    }
    const extPkg = JSON.parse(readFileSync(extPkgPath, "utf-8"));
    const deps = extPkg.dependencies;
    if (!deps) {
      continue;
    }
    let merged = 0;
    for (const [depName, depVer] of Object.entries(deps)) {
      if (typeof depVer === "string" && depVer.startsWith("workspace:")) {
        continue;
      }
      // 根已有同名包时保留根的版本（更保守，避免版本冲突）
      if (!filteredDeps[depName]) {
        filteredDeps[depName] = depVer;
        merged++;
      }
    }
    if (merged > 0) {
      console.log(`[bundle] 合并 extension/${name} 的 ${merged} 个依赖到根 package.json`);
    }
  }
}

const bundlePkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  type: "module",
  main: "dist/index.js",
  dependencies: filteredDeps,
};
writeFileSync(join(bundleDir, "package.json"), JSON.stringify(bundlePkg, null, 2));
console.log(
  `[bundle] 创建 package.json（${Object.keys(filteredDeps).length} 个依赖，含 extension 合并）`,
);

// Step 5: 安装依赖（一次性安装根 + 所有 extension 的依赖）
console.log("\n[bundle] === Step 5: 安装生产依赖（含 extension 依赖）===");
run("npm install --omit=dev --install-strategy=hoisted", { cwd: bundleDir });

// Step 6.6: 删除桌面版不需要的重量级包
console.log("\n[bundle] === Step 6.6: 删除桌面版不需要的重量级包 ===");
{
  // 桌面版通过 API 接入模型，不需要本地推理引擎
  // 仅删除确定不需要的包，保留可能被运行时 import 的包
  const heavyPkgsToRemove = [
    "@node-llama-cpp", // 本地 LLM 推理引擎 (~681MB)
    "node-llama-cpp", // 本地 LLM (~33MB)
    // "@lancedb" 和 "apache-arrow" 已恢复：memory-lancedb 扩展运行时需要
    "bun-types", // Bun 运行时类型 (~3.2MB)
    "@types", // TypeScript 类型声明 (~2.8MB)
    "@anthropic-ai/bedrock-sdk", // AWS Bedrock SDK（桌面版直接用 API）
    // 注意：@mariozechner 不能删除，包含 pi-ai 等核心运行时依赖
    // 注意：以下包不能删除，运行时会 import
    // - discord-api-types: Discord 渠道运行时依赖（dist/send-*.js import）
    // - web-streams-polyfill: openai 等 SDK 依赖
    // - playwright-core + chromium-bidi: 网页内容抓取功能依赖
    // - typescript: 部分 extension 运行时可能需要
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
  // 注意：不要在此列表中加 "docs" 或 "doc"：
  //   - gateway-bundle 自身有 docs/reference/templates/
  //   - yaml 包有 dist/doc/ 目录（含 directives.js 等运行时代码）
  const dirsToRemove = new Set([
    ".git",
    ".github",
    "__tests__",
    "test",
    "tests",
    ".nyc_output",
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

  // 注意：不删除 extension 的 src/ 目录
  // 部分 extension 即使有 dist/ 也会在运行时 require src/ 下的文件
  // 例如 twitch extension 的 src/token.ts 引用 src/routing/session-key.js
  if (existsSync(extDir)) {
    for (const name of readdirSync(extDir)) {
      const extPath = join(extDir, name);
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
