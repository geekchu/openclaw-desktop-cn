#!/usr/bin/env node

/**
 * download-node.js
 *
 * 从 nodejs.org 下载 Node.js 便携版到 src-tauri/node-runtime/{platform}/
 * 支持 Windows x64、macOS arm64、macOS x64 三个平台。
 *
 * 用法:
 *   node scripts/download-node.js                    # 只下载当前平台
 *   node scripts/download-node.js --all              # 下载全部三个平台
 *   node scripts/download-node.js --platform win-x64,darwin-arm64
 */

import { execSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const nodeRuntimeDir = join(projectRoot, "src-tauri", "node-runtime");

function getWindowsPowerShellExe() {
  return join(
    process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

const NODE_VERSION = "v24.13.0";
const NODE_BASE_URL = `https://nodejs.org/dist/${NODE_VERSION}`;
const VERSION_FILE = join(nodeRuntimeDir, ".node-version");

// 平台配置
const PLATFORMS = {
  "win-x64": {
    archiveName: `node-${NODE_VERSION}-win-x64`,
    archiveExt: "zip",
  },
  "darwin-x64": {
    archiveName: `node-${NODE_VERSION}-darwin-x64`,
    archiveExt: "tar.gz",
  },
  "darwin-arm64": {
    archiveName: `node-${NODE_VERSION}-darwin-arm64`,
    archiveExt: "tar.gz",
  },
  "linux-x64": {
    archiveName: `node-${NODE_VERSION}-linux-x64`,
    archiveExt: "tar.xz",
  },
  "linux-arm64": {
    archiveName: `node-${NODE_VERSION}-linux-arm64`,
    archiveExt: "tar.xz",
  },
};

function getCurrentPlatform() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32" && arch === "x64") {
    return "win-x64";
  }
  if (platform === "darwin" && arch === "x64") {
    return "darwin-x64";
  }
  if (platform === "darwin" && arch === "arm64") {
    return "darwin-arm64";
  }
  if (platform === "linux" && arch === "x64") {
    return "linux-x64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "linux-arm64";
  }

  console.warn(`[download-node] 当前平台 ${platform}-${arch} 不在支持列表中`);
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--all")) {
    return Object.keys(PLATFORMS);
  }

  const platformIdx = args.indexOf("--platform");
  if (platformIdx !== -1 && args[platformIdx + 1]) {
    const requested = args[platformIdx + 1].split(",").map((s) => s.trim());
    for (const p of requested) {
      if (!PLATFORMS[p]) {
        console.error(`[download-node] 未知平台: ${p}`);
        console.error(`[download-node] 支持的平台: ${Object.keys(PLATFORMS).join(", ")}`);
        process.exit(1);
      }
    }
    return requested;
  }

  // 默认: 只下载当前平台
  const current = getCurrentPlatform();
  if (!current) {
    console.error("[download-node] 无法确定当前平台，请使用 --platform 参数指定");
    process.exit(1);
  }
  return [current];
}

function isVersionMatch() {
  if (!existsSync(VERSION_FILE)) {
    return false;
  }
  const existing = readFileSync(VERSION_FILE, "utf-8").trim();
  return existing === NODE_VERSION;
}

async function downloadFile(url, destPath) {
  console.log(`[download-node] 下载 ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`下载失败: ${resp.status} ${resp.statusText} — ${url}`);
  }
  const fileStream = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(resp.body), fileStream);
  console.log(`[download-node] 已保存到 ${destPath}`);
}

function findFirstSubdir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const firstDir = entries.find((e) => e.isDirectory());
  if (!firstDir) {
    throw new Error(`解压后未找到子目录: ${dir}`);
  }
  return firstDir.name;
}

async function downloadAndExtractPlatform(platformKey) {
  const config = PLATFORMS[platformKey];
  const destDir = join(nodeRuntimeDir, platformKey);

  // 检查是否已存在且版本匹配
  if (existsSync(destDir) && isVersionMatch()) {
    console.log(`[download-node] ${platformKey}: 已存在且版本匹配 (${NODE_VERSION})，跳过`);
    return;
  }

  const archiveFileName = `${config.archiveName}.${config.archiveExt}`;
  const downloadUrl = `${NODE_BASE_URL}/${archiveFileName}`;
  const archivePath = join(nodeRuntimeDir, archiveFileName);

  mkdirSync(nodeRuntimeDir, { recursive: true });

  // 下载
  await downloadFile(downloadUrl, archivePath);

  // 解压到临时目录
  const tempDir = join(nodeRuntimeDir, "_extract_tmp");
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  mkdirSync(tempDir, { recursive: true });

  if (config.archiveExt === "zip") {
    console.log(`[download-node] 解压 (zip) ${archivePath}`);
    execSync(
      `"${getWindowsPowerShellExe()}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tempDir}' -Force"`,
      { stdio: "inherit" },
    );
  } else if (config.archiveExt === "tar.xz") {
    console.log(`[download-node] 解压 (tar.xz) ${archivePath}`);
    execSync(`tar -xJf "${archivePath}" -C "${tempDir}"`, { stdio: "inherit" });
  } else {
    console.log(`[download-node] 解压 (tar.gz) ${archivePath}`);
    execSync(`tar -xzf "${archivePath}" -C "${tempDir}"`, { stdio: "inherit" });
  }

  // 解压后有一层目录（如 node-v24.13.0-win-x64/），需要提取内层
  const innerDirName = findFirstSubdir(tempDir);
  const innerDir = join(tempDir, innerDirName);

  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }

  // 移动到目标目录
  if (process.platform === "win32") {
    execSync(
      `"${getWindowsPowerShellExe()}" -NoProfile -NonInteractive -Command "Move-Item -Path '${innerDir}' -Destination '${destDir}'"`,
      { stdio: "inherit" },
    );
  } else {
    execSync(`mv "${innerDir}" "${destDir}"`, { stdio: "inherit" });
  }

  // 清理
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  console.log(`[download-node] ${platformKey}: 完成`);
}

async function main() {
  const platforms = parseArgs();
  console.log(`[download-node] Node.js 版本: ${NODE_VERSION}`);
  console.log(`[download-node] 目标平台: ${platforms.join(", ")}`);
  console.log(`[download-node] 输出目录: ${nodeRuntimeDir}`);

  mkdirSync(nodeRuntimeDir, { recursive: true });

  for (const platform of platforms) {
    await downloadAndExtractPlatform(platform);
  }

  // 写入版本标记文件
  writeFileSync(VERSION_FILE, NODE_VERSION);
  console.log(`[download-node] 版本标记已写入: ${VERSION_FILE}`);
}

main().catch((err) => {
  console.error(`[download-node] 错误: ${err.message}`);
  process.exit(1);
});
