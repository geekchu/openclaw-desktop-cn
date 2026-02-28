#!/usr/bin/env bash
# ── OpenClaw 更新服务器初始化脚本 ──
# 在 openclawcn.net 服务器上运行一次，创建目录和占位文件
#
# 用法: ssh root@openclawcn.net 'bash -s' < scripts/setup-update-server.sh
#
# Nginx 配置请使用 deploy-update-nginx.sh（需在服务器上直接运行）

set -euo pipefail

WEBROOT="/var/www/openclaw-update"

echo "🔧 初始化 OpenClaw 更新服务器..."

# 创建目录
mkdir -p "$WEBROOT/artifacts"
echo "  ✅ 创建目录: $WEBROOT"

# 创建占位 latest.json
if [ ! -f "$WEBROOT/latest.json" ]; then
  cat > "$WEBROOT/latest.json" << 'EOF'
{
  "version": "0.0.0",
  "notes": "暂无更新",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {}
}
EOF
  echo "  ✅ 创建占位 latest.json"
else
  echo "  ℹ latest.json 已存在，跳过"
fi

echo ""
echo "🎉 服务器目录初始化完成！"
echo ""
echo "⚠️  下一步：在服务器上运行 deploy-update-nginx.sh 配置 Nginx"
echo "   scp scripts/deploy-update-nginx.sh root@openclawcn.net:/tmp/"
echo "   ssh root@openclawcn.net 'bash /tmp/deploy-update-nginx.sh'"
