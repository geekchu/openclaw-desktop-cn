#!/bin/bash
set -e

echo "========================================"
echo "  OpenClaw 命令设置工具"
echo "========================================"
echo ""

# 查找 OpenClaw 安装目录
if [ "$(uname)" = "Darwin" ]; then
    # macOS
    OPENCLAW_DIR="/Applications/OpenClaw.app/Contents/Resources"
else
    # Linux
    OPENCLAW_DIR="$HOME/.local/share/openclaw"
    if [ ! -d "$OPENCLAW_DIR" ]; then
        OPENCLAW_DIR="/opt/OpenClaw/resources"
    fi
fi

if [ ! -d "$OPENCLAW_DIR" ]; then
    echo "[错误] 未找到 OpenClaw 安装目录"
    exit 1
fi

# 查找 gateway bundle
BUNDLE_DIR="$OPENCLAW_DIR/gateway-bundle"
if [ ! -f "$BUNDLE_DIR/dist/entry.js" ]; then
    echo "[错误] 未找到 gateway bundle: $BUNDLE_DIR/dist/entry.js"
    exit 1
fi

# 查找 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 Node.js，请先安装"
    exit 1
fi

NODE_PATH=$(which node)

# 创建命令目录
BIN_DIR="$HOME/.openclaw/bin"
mkdir -p "$BIN_DIR"

# 创建 openclaw 脚本
CMD_FILE="$BIN_DIR/openclaw"
cat > "$CMD_FILE" << EOF
#!/bin/sh
exec "$NODE_PATH" "$BUNDLE_DIR/dist/entry.js" "\$@"
EOF

chmod +x "$CMD_FILE"

echo "[成功] 已创建 openclaw 命令"
echo "位置: $CMD_FILE"
echo ""
echo "========================================"
echo "  重要：添加到 PATH"
echo "========================================"
echo "请运行以下命令添加到 PATH："
echo ""

if [ -f "$HOME/.zshrc" ]; then
    echo "echo 'export PATH=\"\$HOME/.openclaw/bin:\$PATH\"' >> ~/.zshrc"
    echo "source ~/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
    echo "echo 'export PATH=\"\$HOME/.openclaw/bin:\$PATH\"' >> ~/.bashrc"
    echo "source ~/.bashrc"
else
    echo "export PATH=\"\$HOME/.openclaw/bin:\$PATH\""
fi

echo ""
