#!/bin/bash
# Deploy update location block to openclawcn.net Nginx config
set -euo pipefail

CONF="/etc/nginx/sites-available/openclawcn.net"

# Build only the location blocks that are missing so reruns can add new updater endpoints.
TMPF=$(mktemp)
trap 'rm -f "$TMPF"' EXIT

if ! grep -q 'location /update/' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'BLOCK'

    # ── OpenClaw Auto-Update static files ──
    location /update/ {
        alias /var/www/openclaw-update/;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        default_type application/octet-stream;
    }

BLOCK
fi

if ! grep -q 'location = /update/latest.json' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'BLOCK'
    location = /update/latest.json {
        alias /var/www/openclaw-update/latest.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache" always;
        default_type application/json;
    }
BLOCK
fi

if ! grep -q 'location = /update/latest-macos.json' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'BLOCK'
    location = /update/latest-macos.json {
        alias /var/www/openclaw-update/latest-macos.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache" always;
        default_type application/json;
    }
BLOCK
fi

if ! grep -q 'location = /update/latest-windows.json' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'BLOCK'
    location = /update/latest-windows.json {
        alias /var/www/openclaw-update/latest-windows.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache" always;
        default_type application/json;
    }
BLOCK
fi

if ! grep -q 'location = /update/latest-linux.json' "$CONF" 2>/dev/null; then
  cat >> "$TMPF" << 'BLOCK'
    location = /update/latest-linux.json {
        alias /var/www/openclaw-update/latest-linux.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache" always;
        default_type application/json;
    }
BLOCK
fi

if [ -s "$TMPF" ]; then
  # Insert before the first "location / {" in the SSL server block
  # Find the line number of the LAST "location / {" (the SSL server block one)
  LAST_LOC=$(grep -n 'location / {' "$CONF" | tail -1 | cut -d: -f1)
  if [ -z "$LAST_LOC" ]; then
    echo "ERROR: Could not find 'location / {' in $CONF"
    exit 1
  fi

  # Insert our block before the last "location / {" line
  head -n $((LAST_LOC - 1)) "$CONF" > "${CONF}.new"
  cat "$TMPF" >> "${CONF}.new"
  tail -n +${LAST_LOC} "$CONF" >> "${CONF}.new"
  mv "${CONF}.new" "$CONF"
  echo "OK: Inserted missing updater location blocks into $CONF"
else
  echo "INFO: updater location blocks already exist in $CONF, skipping."
fi

# Create update directory and placeholder
mkdir -p /var/www/openclaw-update/artifacts
for latest_file in latest.json latest-macos.json latest-windows.json latest-linux.json; do
  if [ ! -f "/var/www/openclaw-update/${latest_file}" ]; then
    echo '{"version":"0.0.0","notes":"暂无更新","pub_date":"2026-01-01T00:00:00Z","platforms":{}}' > "/var/www/openclaw-update/${latest_file}"
    echo "OK: Created placeholder ${latest_file}"
  fi
done

# Test and reload nginx
nginx -t 2>&1
nginx -s reload
echo "DEPLOY_COMPLETE"
