#!/bin/bash
# Deploy update location block to openclawcn.net Nginx config
set -euo pipefail

CONF="/etc/nginx/sites-available/openclawcn.net"

# Check if /update/ location already exists
if grep -q 'location /update/' "$CONF" 2>/dev/null; then
  echo "INFO: /update/ location already exists in $CONF, skipping."
else
  # Create a temp file with the update location block
  TMPF=$(mktemp)
  cat > "$TMPF" << 'BLOCK'

    # ── OpenClaw Auto-Update static files ──
    location /update/ {
        alias /var/www/openclaw-update/;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        default_type application/octet-stream;
    }

    location = /update/latest.json {
        alias /var/www/openclaw-update/latest.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache" always;
        default_type application/json;
    }
BLOCK

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
  rm -f "$TMPF"
  echo "OK: Inserted /update/ location block into $CONF"
fi

# Create update directory and placeholder
mkdir -p /var/www/openclaw-update/artifacts
if [ ! -f /var/www/openclaw-update/latest.json ]; then
  echo '{"version":"0.0.0","notes":"暂无更新","pub_date":"2026-01-01T00:00:00Z","platforms":{}}' > /var/www/openclaw-update/latest.json
  echo "OK: Created placeholder latest.json"
fi

# Test and reload nginx
nginx -t 2>&1
nginx -s reload
echo "DEPLOY_COMPLETE"
