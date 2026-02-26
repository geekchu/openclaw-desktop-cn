#!/usr/bin/env bash
# ── OpenClaw 更新服务器初始化脚本 ──
# 在 openclawcn.net 服务器上运行一次即可
#
# 用法: ssh root@openclawcn.net 'bash -s' < scripts/setup-update-server.sh

set -euo pipefail

WEBROOT="/var/www/openclaw-update"

echo "🔧 初始化 OpenClaw 更新服务器..."

# 创建目录
mkdir -p "$WEBROOT/artifacts"
echo "  ✅ 创建目录: $WEBROOT"

# 写入 Nginx 配置
cat > /etc/nginx/conf.d/openclaw-update.conf << 'EOF'
# OpenClaw 自动更新文件服务
location /update/ {
    alias /var/www/openclaw-update/;
    add_header Access-Control-Allow-Origin "https://tauri.localhost";
    add_header Cache-Control "no-cache, no-store, must-revalidate";

    # 允许 latest.json 不被缓存
    location = /update/latest.json {
        alias /var/www/openclaw-update/latest.json;
        add_header Access-Control-Allow-Origin "https://tauri.localhost";
        add_header Cache-Control "no-cache";
        default_type application/json;
    }
}
EOF
echo "  ✅ 写入 Nginx 配置: /etc/nginx/conf.d/openclaw-update.conf"

# 创建占位 latest.json
cat > "$WEBROOT/latest.json" << 'EOF'
{
  "version": "0.0.0",
  "notes": "暂无更新",
  "pub_date": "2026-01-01T00:00:00Z",
  "platforms": {}
}
EOF
echo "  ✅ 创建占位 latest.json"

# 测试并重载 Nginx
nginx -t && nginx -s reload
echo "  ✅ Nginx 配置已重载"

echo ""
echo "🎉 服务器初始化完成！"
echo "   更新端点: https://openclawcn.net/update/latest.json"
echo ""
echo "⚠️  注意事项:"
echo "   1. 请确保 Nginx 主配置中包含了 /etc/nginx/conf.d/*.conf"
echo "   2. 请确保 HTTPS 已配置（SSL 证书 + 443 监听）"
echo "   3. 可能需要根据现有 Nginx 配置调整 location 块的位置"
