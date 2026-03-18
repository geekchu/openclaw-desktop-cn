#!/usr/bin/env node

/**
 * build-installer.js
 *
 * 统一构建入口脚本：环境检查 → 依赖安装 → Node.js 下载 → Tauri 构建 → 产物归档
 *
 * 用法:
 *   node scripts/build-installer.js              # release 构建
 *   node scripts/build-installer.js --debug      # debug 构建（更快）
 *   node scripts/build-installer.js --skip-deps  # 跳过 pnpm install
 *   node scripts/build-installer.js --verbose    # 详细输出
 *   node scripts/build-installer.js --target aarch64-apple-darwin   # macOS ARM
 *   node scripts/build-installer.js --target x86_64-apple-darwin    # macOS Intel
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const tauriDir = join(projectRoot, "src-tauri");
const distInstallersDir = join(projectRoot, "dist", "installers");

// -- 参数解析 --

const args = process.argv.slice(2);
const argsSet = new Set(args);
const isDebug = argsSet.has("--debug");
const skipDeps = argsSet.has("--skip-deps");
const verbose = argsSet.has("--verbose");
const buildProfile = isDebug ? "debug" : "release";

// 解析 --target 参数
let targetArch = null;
const targetIndex = args.indexOf("--target");
if (targetIndex !== -1 && args[targetIndex + 1]) {
  targetArch = args[targetIndex + 1];
}

function ensureSupportedMacTarget() {
  if (targetArch === "universal-apple-darwin" || process.env.TAURI_UNIVERSAL === "1") {
    throw new Error(
      "macOS 发布流程已禁用 Universal 包，请改用 --target aarch64-apple-darwin 或 --target x86_64-apple-darwin",
    );
  }

  if (process.platform === "darwin" && !isDebug && !targetArch) {
    throw new Error(
      "macOS release 构建必须显式指定 --target aarch64-apple-darwin 或 --target x86_64-apple-darwin",
    );
  }
}

function log(msg) {
  console.log(`[build] ${msg}`);
}

function logStep(step, title) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Step ${step}: ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

function run(cmd, opts = {}) {
  if (verbose) {
    log(`$ ${cmd}`);
  }
  try {
    execSync(cmd, { stdio: "inherit", cwd: projectRoot, ...opts });
  } catch (err) {
    throw new Error(`命令执行失败: ${cmd}`, { cause: err });
  }
}

function getCommandVersion(cmd, flag = "--version") {
  try {
    return execSync(`${cmd} ${flag}`, { encoding: "utf-8" }).trim().split("\n")[0];
  } catch {
    return null;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMacArchSuffix() {
  if (targetArch === "aarch64-apple-darwin") {
    return "aarch64";
  }
  if (targetArch === "x86_64-apple-darwin") {
    return "x64";
  }
  return null;
}

function getCopiedArtifactName(name) {
  const archSuffix = getMacArchSuffix();
  if (!archSuffix) {
    return name;
  }
  if (name.endsWith(".app.tar.gz.sig")) {
    return name.replace(".app.tar.gz.sig", `_${archSuffix}.app.tar.gz.sig`);
  }
  if (name.endsWith(".app.tar.gz")) {
    return name.replace(".app.tar.gz", `_${archSuffix}.app.tar.gz`);
  }
  return name;
}

function getArtifactCleanupNames(name) {
  return new Set([name, getCopiedArtifactName(name)]);
}

function isEncryptedSigningKey(signingKey) {
  const raw = signingKey.toLowerCase();
  if (raw.includes("encrypted")) {
    return true;
  }

  const decoded = Buffer.from(signingKey, "base64").toString("utf-8").toLowerCase();
  return decoded.includes("encrypted");
}

// -- Step 0: 环境检查 --

function checkEnvironment() {
  logStep(0, "环境检查");
  let ok = true;
  const requiresSigning = !isDebug;

  // Node.js
  const nodeVersion = getCommandVersion("node");
  if (nodeVersion) {
    const major = parseInt(nodeVersion.replace(/^v/, ""), 10);
    if (major >= 22) {
      log(`✓ Node.js: ${nodeVersion}`);
    } else {
      log(`✗ Node.js 版本过低: ${nodeVersion} (需要 >= 22)`);
      ok = false;
    }
  } else {
    log("✗ Node.js 未找到");
    ok = false;
  }

  // pnpm
  const pnpmVersion = getCommandVersion("pnpm");
  if (pnpmVersion) {
    log(`✓ pnpm: ${pnpmVersion}`);
  } else {
    log("✗ pnpm 未找到 (npm install -g pnpm)");
    ok = false;
  }

  const rustcVersion = getCommandVersion("rustc");
  if (rustcVersion) {
    log(`✓ rustc: ${rustcVersion}`);
  } else {
    log("✗ rustc 未找到 (https://rustup.rs/)");
    ok = false;
  }
  const cargoVersion = getCommandVersion("cargo");
  if (cargoVersion) {
    log(`✓ cargo: ${cargoVersion}`);
  } else {
    log("✗ cargo 未找到 (https://rustup.rs/)");
    ok = false;
  }

  // cargo-tauri
  const tauriVersion = getCommandVersion("cargo", "tauri --version");
  if (tauriVersion) {
    log(`✓ cargo-tauri: ${tauriVersion}`);
  } else {
    log('✗ cargo-tauri 未找到 (cargo install tauri-cli --version "^2")');
    ok = false;
  }

  // Windows-specific: NSIS not required (Tauri downloads its own bundler)
  if (process.platform === "win32") {
    log("ℹ Windows: NSIS 由 Tauri 自动下载，无需手动安装");
  }

  // Signing key check
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    if (requiresSigning) {
      log("✗ release 构建必须设置 TAURI_SIGNING_PRIVATE_KEY 环境变量");
      log("  否则不会生成 .sig，无法用于自动更新发布");
    } else {
      log("⚠ 未设置 TAURI_SIGNING_PRIVATE_KEY 环境变量");
      log("  debug 构建可继续，但不会生成 .sig 签名文件");
    }
    log(
      "  设置方法 (PowerShell): $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/openclaw.key -Raw",
    );
    if (requiresSigning) {
      ok = false;
    }
  } else if (
    isEncryptedSigningKey(process.env.TAURI_SIGNING_PRIVATE_KEY) &&
    !process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  ) {
    if (requiresSigning) {
      log("✗ release 构建必须设置 TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
      log("  否则签名步骤可能卡住或失败");
      ok = false;
    } else {
      log("⚠ 签名私钥已加密，但未设置 TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
      log("  构建过程可能会卡住等待密码输入");
    }
    log("  设置方法 (PowerShell): $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '你的密码'");
  }

  if (!ok) {
    log("\n环境检查未通过，请安装缺少的工具后重试。");
    process.exit(1);
  }

  log("\n环境检查通过!");
}

// -- Step 1: 安装依赖 --

function installDeps() {
  logStep(1, "安装依赖");

  if (skipDeps) {
    log("跳过 (--skip-deps)");
    return;
  }

  log("运行 pnpm install ...");
  run("pnpm install");
  log("依赖安装完成");
}

// -- Step 2: 下载 Node.js 运行环境 --

function downloadNode() {
  logStep(2, "下载 Node.js 运行环境");

  log("运行 node scripts/download-node.js ...");
  run("node scripts/download-node.js", {
    env: {
      ...process.env,
      OPENCLAW_BUNDLE_TARGET_TRIPLE: targetArch || "",
    },
  });
  log("Node.js 运行环境就绪");
}

// -- Step 3: Tauri 构建 --

function tauriBuild() {
  const targetDesc = targetArch ? ` (target: ${targetArch})` : "";
  logStep(3, `Tauri 构建 (${buildProfile})${targetDesc}`);

  const debugFlag = isDebug ? " --debug" : "";
  const targetFlag = targetArch ? ` --target ${targetArch}` : "";
  const cmd = `cargo tauri build${debugFlag}${targetFlag}`;

  log(`运行 ${cmd} ...`);
  log("(beforeBuildCommand 将自动执行 prepare-gateway-bundle.js)");

  // beforeBuildCommand path is relative to cwd, so run from project root
  run(cmd, {
    env: {
      ...process.env,
      OPENCLAW_BUNDLE_TARGET_TRIPLE: targetArch || "",
    },
  });

  log("Tauri 构建完成");
}

// -- Step 4: 收集产物 --

function collectArtifacts() {
  logStep(4, "收集构建产物");

  // 根据 target 确定产物目录
  let bundleDir;
  if (targetArch) {
    bundleDir = join(tauriDir, "target", targetArch, buildProfile, "bundle");
  } else {
    bundleDir = join(tauriDir, "target", buildProfile, "bundle");
  }

  if (!existsSync(bundleDir)) {
    log(`产物目录不存在: ${bundleDir}`);
    log("构建可能未成功完成。");
    process.exit(1);
  }

  // 扫描产物
  const artifacts = [];

  function scanDir(dir, depth = 0) {
    if (!existsSync(dir) || depth > 4) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, depth + 1);
      } else if (isInstallerFile(entry.name)) {
        const stat = statSync(fullPath);
        artifacts.push({ path: fullPath, name: entry.name, size: stat.size });
      }
    }
  }

  scanDir(bundleDir);

  if (artifacts.length === 0) {
    log("未找到安装包文件。");
    log(`请检查 ${bundleDir} 目录。`);
    process.exit(1);
  }

  // 显示找到的产物
  log("找到的安装包:");
  for (const a of artifacts) {
    log(`  ${a.name}  (${formatSize(a.size)})`);
  }

  const copiedArtifactNames = new Set(
    artifacts.flatMap((artifact) => Array.from(getArtifactCleanupNames(artifact.name))),
  );

  // 清理旧产物
  if (existsSync(distInstallersDir)) {
    for (const entry of readdirSync(distInstallersDir)) {
      const fullPath = join(distInstallersDir, entry);
      if (statSync(fullPath).isFile() && isInstallerFile(entry)) {
        if (targetArch && !copiedArtifactNames.has(entry)) {
          continue;
        }
        try {
          unlinkSync(fullPath);
        } catch {
          log(`警告: 无法删除旧文件 ${entry}（可能被占用）`);
        }
      }
    }
  }
  mkdirSync(distInstallersDir, { recursive: true });

  log(`\n复制到 ${distInstallersDir}:`);
  for (const a of artifacts) {
    const destPath = join(distInstallersDir, getCopiedArtifactName(a.name));
    cpSync(a.path, destPath);
    log(`  → ${destPath}`);
  }

  return artifacts;
}

function isInstallerFile(name) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".exe") ||
    lower.endsWith(".msi") ||
    lower.endsWith(".dmg") ||
    lower.endsWith(".app.tar.gz") ||
    lower.endsWith(".appimage") ||
    lower.endsWith(".deb") ||
    lower.endsWith(".rpm") ||
    lower.endsWith(".sig")
  );
}

// -- 主流程 --

function main() {
  const startTime = Date.now();
  ensureSupportedMacTarget();

  const targetDesc = targetArch ? ` (target: ${targetArch})` : "";
  console.log(`\n  OpenClaw Desktop 安装包构建`);
  console.log(`  模式: ${buildProfile}${targetDesc}`);
  console.log(`  主机: ${process.platform}-${process.arch}`);
  console.log(`  时间: ${new Date().toLocaleString()}\n`);

  checkEnvironment();
  installDeps();
  downloadNode();
  tauriBuild();
  const artifacts = collectArtifacts();

  // 摘要
  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;

  console.log(`\n${"=".repeat(60)}`);
  console.log("  构建完成!");
  console.log(`${"=".repeat(60)}\n`);
  log(`耗时: ${minutes}m ${seconds}s`);
  log(`模式: ${buildProfile}`);
  log(`产物目录: ${distInstallersDir}`);
  log(`产物列表:`);
  for (const a of artifacts) {
    log(`  ${a.name}  (${formatSize(a.size)})`);
  }
  console.log();
}

try {
  main();
} catch (err) {
  console.error(`\n[build] 构建失败: ${err.message}`);
  if (verbose && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
