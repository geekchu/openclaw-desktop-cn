#!/bin/bash
# 在原服务器上配置 cdn.openclawcn.net 子域名
# 用法: ssh root@47.57.241.17 'bash -s' < scripts/deploy-cdn-nginx.sh
#
# 前提: 已在 DNS 中将 cdn.openclawcn.net 指向 47.57.241.17
# 当前临时指向原服务器，后续会切换到真正的 CDN

set -euo pipefail

DOMAIN="cdn.openclawcn.net"
CONF="/etc/nginx/sites-available/${DOMAIN}"
ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
UPDATE_DIR="/var/www/openclaw-update"

# 检查是否已配置
if [ ! -f "$CONF" ]; then
  echo ">>> 创建 Nginx 配置: ${CONF}"
  cat > "$CONF" << 'EOF'
server {
    listen 80;
    server_name cdn.openclawcn.net;

    # 只提供安装包下载（/update/artifacts/）
    location /update/artifacts/ {
        alias /var/www/openclaw-update/artifacts/;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "public, max-age=86400" always;
        default_type application/octet-stream;

        # 支持中文文件名
        charset utf-8;
    }

    # 阻止访问 updater 元数据（仅由 openclawcn.net 提供）
    location /update/latest.json {
        return 404;
    }

    location /update/latest-macos.json {
        return 404;
    }

    location /update/latest-windows.json {
        return 404;
    }

    # 其他路径一律 404
    location / {
        return 404;
    }
}
EOF

  # 启用站点
  ln -sf "$CONF" "$ENABLED"
  echo "OK: 已创建并启用 ${DOMAIN} 配置"
fi

TMPF=$(mktemp)
trap 'rm -f "$TMPF"' EXIT

if ! grep -q 'location /update/latest.json' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'EOF'

    location /update/latest.json {
        return 404;
    }
EOF
fi

if ! grep -q 'location /update/latest-macos.json' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'EOF'

    location /update/latest-macos.json {
        return 404;
    }
EOF
fi

if ! grep -q 'location /update/latest-windows.json' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'EOF'

    location /update/latest-windows.json {
        return 404;
    }
EOF
fi

if [ -s "$TMPF" ]; then
  LAST_LOC=$(grep -n 'location / {' "$CONF" | tail -1 | cut -d: -f1)
  if [ -z "$LAST_LOC" ]; then
    echo "ERROR: Could not find 'location / {' in $CONF"
    exit 1
  fi

  head -n $((LAST_LOC - 1)) "$CONF" > "${CONF}.new"
  cat "$TMPF" >> "${CONF}.new"
  tail -n +${LAST_LOC} "$CONF" >> "${CONF}.new"
  mv "${CONF}.new" "$CONF"
  echo "OK: 已补齐 updater 元数据 404 规则"
else
  echo "INFO: ${DOMAIN} updater 元数据 404 规则已存在，跳过"
fi

# 确保 artifacts 目录存在
mkdir -p "${UPDATE_DIR}/artifacts"

# 测试 Nginx 配置
nginx -t 2>&1

# 重载 Nginx
nginx -s reload
echo "OK: Nginx 已重载"

# 尝试用 certbot 申请 SSL 证书
if command -v certbot &>/dev/null; then
  echo ">>> 申请 SSL 证书..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect \
    --email admin@openclawcn.net 2>&1 || {
    echo "WARN: certbot 自动申请失败，请手动运行:"
    echo "  certbot --nginx -d ${DOMAIN}"
  }
else
  echo "WARN: certbot 未安装，请手动安装并申请 SSL:"
  echo "  apt install certbot python3-certbot-nginx"
  echo "  certbot --nginx -d ${DOMAIN}"
fi

echo ""
echo "=== CDN 子域名配置完成 ==="
echo "  域名: https://${DOMAIN}"
echo "  文件目录: ${UPDATE_DIR}/artifacts/"
echo "  测试: curl -I https://${DOMAIN}/update/artifacts/"
