# OpenClaw 桌面版 — 自动更新部署指南

## 架构概览

```
┌─────────────┐     检查更新      ┌──────────────────────────────────┐
│  客户端 App  │ ──────────────→  │  api.openclawcn.net/update/      │
│  (Tauri v2)  │  ← latest.json  │  (Nginx 静态文件, HTTPS/SSL)     │
│              │                  │                                  │
│              │  ← 下载安装包     │  /var/www/openclaw-update/       │
│              │                  │    ├── latest.json                │
│              │                  │    └── artifacts/                 │
└─────────────┘                  │        └── *-setup.exe            │
                                 └──────────────────────────────────┘
```

- **客户端** 启动 5 秒后自动检查，也可在「系统设置 → 软件更新」手动检查
- **服务器** `8.223.32.138`，复用 `api.openclawcn.net` 的 SSL 证书

---

## 发布新版本

### 步骤 1：修改版本号

编辑 `src-tauri/tauri.conf.json`：

```json
"version": "0.2.0"
```

> [!IMPORTANT]
> 新版本号必须大于当前版本（当前为 `0.1.0`），否则客户端不会触发更新。

---

### 步骤 2：构建签名安装包

```powershell
# 设置签名私钥环境变量
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\openclaw.key" -Raw

# 构建
cargo tauri build
```

构建产物位置：

| 平台 | 路径 | 文件 |
|------|------|------|
| Windows | `bundle/nsis/` | `*_x64-setup.exe` + `.sig` |
| macOS | `bundle/macos/` | `*.app.tar.gz` + `.sig` |
| Linux | `bundle/appimage/` | `*.AppImage` + `.sig` |

---

### 步骤 3：发布到服务器

#### 方式 A：使用脚本（推荐）

在 Git Bash 或 WSL 中运行：

```bash
bash scripts/publish-update.sh 0.2.0 root@8.223.32.138
```

脚本自动完成：收集构建产物 → 读取 `.sig` 签名 → 生成 `latest.json` → scp 上传。

#### 方式 B：手动操作

**1) 上传安装包**

```powershell
scp src-tauri\target\release\bundle\nsis\*setup.exe root@8.223.32.138:/var/www/openclaw-update/artifacts/
```

**2) 读取签名**

```powershell
$sig = Get-Content "src-tauri\target\release\bundle\nsis\*setup.exe.sig" -Raw
Write-Host $sig
```

**3) 在服务器上写入 latest.json**

```bash
ssh root@8.223.32.138

cat > /var/www/openclaw-update/latest.json << 'EOF'
{
  "version": "0.2.0",
  "notes": "Bug fixes and improvements",
  "pub_date": "2026-02-18T16:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://api.openclawcn.net/update/artifacts/你的安装包文件名.exe",
      "signature": "粘贴 .sig 文件的完整内容"
    }
  }
}
EOF
```

---

### 步骤 4：验证

```powershell
curl https://api.openclawcn.net/update/latest.json
```

确认返回的 JSON 中 `version` 为新版本号，`signature` 不为空。

---

## latest.json 格式参考

```json
{
  "version": "0.2.0",
  "notes": "更新说明（会显示在更新横幅中）",
  "pub_date": "2026-02-18T16:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://api.openclawcn.net/update/artifacts/OpenClaw桌面版_0.2.0_x64-setup.exe",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    },
    "darwin-x86_64": {
      "url": "https://api.openclawcn.net/update/artifacts/OpenClaw桌面版.app.tar.gz",
      "signature": "..."
    },
    "darwin-aarch64": {
      "url": "https://api.openclawcn.net/update/artifacts/OpenClaw桌面版.app.tar.gz",
      "signature": "..."
    },
    "linux-x86_64": {
      "url": "https://api.openclawcn.net/update/artifacts/OpenClaw桌面版_0.2.0_amd64.AppImage",
      "signature": "..."
    }
  }
}
```

> [!TIP]
> 只需填写本次构建的目标平台，其他平台可省略。

---

## 注意事项

| 项目 | 说明 |
|------|------|
| 私钥安全 | `~/.tauri/openclaw.key` 不要提交到 Git，不要泄露 |
| 签名文件 | `.sig` 内容是完整的 Base64 字符串，必须一字不差 |
| 文件名匹配 | `url` 中的文件名必须与实际上传的文件名完全一致 |
| 服务器密码 | `root@8.223.32.138`，建议后续改为 SSH 密钥登录 |
| HTTPS 必需 | Tauri updater 要求 HTTPS，当前通过 `api.openclawcn.net` 的 Let's Encrypt 证书实现 |

---

## 相关文件

| 文件 | 用途 |
|------|------|
| `src-tauri/tauri.conf.json` | 版本号 + updater 配置（公钥、端点 URL） |
| `scripts/publish-update.sh` | 一键发布脚本 |
| `scripts/deploy-update-nginx.sh` | 服务器 Nginx 初始化脚本（已执行过） |
| `~/.tauri/openclaw.key` | 签名私钥 |
| `ui/src/ui/views/updater.ts` | 前端自动更新模块 |
| `ui/src/ui/views/config-system-settings.ts` | 「软件更新」设置卡片 |
