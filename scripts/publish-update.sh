#!/usr/bin/env bash
# ── OpenClaw 更新发布脚本 ──
# 用法: ./scripts/publish-update.sh <版本号> <服务器用户@地址>
# 示例: ./scripts/publish-update.sh 0.2.0 root@openclawcn.net
#
# 前提条件:
# 1. 已完成 `cargo tauri build`（且设置了 TAURI_SIGNING_PRIVATE_KEY 环境变量）
# 2. 服务器已通过 setup-update-server.sh 初始化
# 3. 本机已配置 SSH 密钥登录

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "❌ 需要安装 jq"; exit 1; }

VERSION="${1:?用法: $0 <版本号> <用户@服务器>}"
SERVER="${2:?用法: $0 <版本号> <用户@服务器>}"
REMOTE_DIR="/var/www/openclaw-update"

BUNDLE_BASE="src-tauri/target/release/bundle"
TEMP_JSON=$(mktemp)

echo "📦 发布 OpenClaw v${VERSION} 更新到 ${SERVER}..."

# ── 收集各平台构建产物 ──

declare -A PLATFORMS
declare -A SIGS

# Windows NSIS
NSIS_DIR="${BUNDLE_BASE}/nsis"
if [ -d "$NSIS_DIR" ]; then
  NSIS_FILE=$(find "$NSIS_DIR" -name "*-setup.exe" -not -name "*.sig" 2>/dev/null | head -1)
  NSIS_SIG="${NSIS_FILE}.sig"
  if [ -f "$NSIS_FILE" ] && [ -f "$NSIS_SIG" ]; then
    PLATFORMS["windows-x86_64"]="$NSIS_FILE"
    SIGS["windows-x86_64"]=$(cat "$NSIS_SIG")
    echo "  ✅ Windows NSIS: $(basename "$NSIS_FILE")"
  fi
fi

# macOS
MACOS_DIR="${BUNDLE_BASE}/macos"
if [ -d "$MACOS_DIR" ]; then
  MAC_FILE=$(find "$MACOS_DIR" -name "*.app.tar.gz" -not -name "*.sig" 2>/dev/null | head -1)
  MAC_SIG="${MAC_FILE}.sig"
  if [ -f "$MAC_FILE" ] && [ -f "$MAC_SIG" ]; then
    SIG_CONTENT=$(cat "$MAC_SIG")
    PLATFORMS["darwin-x86_64"]="$MAC_FILE"
    SIGS["darwin-x86_64"]="$SIG_CONTENT"
    PLATFORMS["darwin-aarch64"]="$MAC_FILE"
    SIGS["darwin-aarch64"]="$SIG_CONTENT"
    echo "  ✅ macOS: $(basename "$MAC_FILE")"
  fi
fi

# Linux AppImage
APPIMAGE_DIR="${BUNDLE_BASE}/appimage"
if [ -d "$APPIMAGE_DIR" ]; then
  LINUX_FILE=$(find "$APPIMAGE_DIR" -name "*.AppImage" -not -name "*.sig" 2>/dev/null | head -1)
  LINUX_SIG="${LINUX_FILE}.sig"
  if [ -f "$LINUX_FILE" ] && [ -f "$LINUX_SIG" ]; then
    PLATFORMS["linux-x86_64"]="$LINUX_FILE"
    SIGS["linux-x86_64"]=$(cat "$LINUX_SIG")
    echo "  ✅ Linux AppImage: $(basename "$LINUX_FILE")"
  fi
fi

if [ ${#PLATFORMS[@]} -eq 0 ]; then
  echo "❌ 未找到任何构建产物。请先运行 cargo tauri build。"
  exit 1
fi

# ── 生成 latest.json ──

PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 构建 platforms JSON
PLATFORMS_JSON="{}"
for PLATFORM in "${!PLATFORMS[@]}"; do
  FILE="${PLATFORMS[$PLATFORM]}"
  SIG="${SIGS[$PLATFORM]}"
  FILENAME=$(basename "$FILE")
  URL="https://api.openclawcn.net/update/artifacts/${FILENAME}"
  PLATFORMS_JSON=$(echo "$PLATFORMS_JSON" | jq \
    --arg p "$PLATFORM" \
    --arg url "$URL" \
    --arg sig "$SIG" \
    '.[$p] = {"url": $url, "signature": $sig}')
done

# 构建完整 latest.json
jq -n \
  --arg ver "$VERSION" \
  --arg notes "OpenClaw v${VERSION} 更新" \
  --arg date "$PUB_DATE" \
  --argjson platforms "$PLATFORMS_JSON" \
  '{version: $ver, notes: $notes, pub_date: $date, platforms: $platforms}' \
  > "$TEMP_JSON"

echo ""
echo "📄 latest.json:"
cat "$TEMP_JSON"
echo ""

# ── 上传文件到服务器 ──

echo "🚀 上传构建产物..."

# 确保远程目录存在
ssh "$SERVER" "mkdir -p ${REMOTE_DIR}/artifacts"

# 上传安装包
for PLATFORM in "${!PLATFORMS[@]}"; do
  FILE="${PLATFORMS[$PLATFORM]}"
  echo "  📤 $(basename "$FILE")"
  scp "$FILE" "${SERVER}:${REMOTE_DIR}/artifacts/"
done

# 上传 latest.json
echo "  📤 latest.json"
scp "$TEMP_JSON" "${SERVER}:${REMOTE_DIR}/latest.json"

rm -f "$TEMP_JSON"

echo ""
echo "✅ 发布完成！v${VERSION} 的更新文件已上传到 ${SERVER}"
echo "   更新端点: https://api.openclawcn.net/update/latest.json"
