# OpenClaw 桌面版 — 发版流程

## 目录

- [架构概览](#架构概览)
- [环境准备（一次性）](#环境准备一次性)
- [每次发版流程](#每次发版流程)
- [自动更新机制](#自动更新机制)
- [latest.json 格式参考](#latestjson-格式参考)
- [服务器维护](#服务器维护)
- [macOS 代码签名与公证（一次性设置）](#macos-代码签名与公证一次性设置)
- [Windows 代码签名（后续）](#windows-代码签名后续)
- [故障排查](#故障排查)
- [相关文件索引](#相关文件索引)

---

## 架构概览

```
┌──────────────────┐                    ┌───────────────────────────────────┐
│  客户端 App       │   检查更新 (HTTPS)  │  openclawcn.net                   │
│  (Tauri v2)      │ ──────────────────→ │  Nginx 静态文件服务                │
│                  │  ← latest.json     │                                   │
│                  │                    │  /var/www/openclaw-update/         │
│                  │  ← 下载安装包       │    ├── latest.json                 │
│                  │                    │    └── artifacts/                  │
│                  │                    │        ├── *-setup.exe             │
└──────────────────┘                    │        ├── *.app.tar.gz            │
                                        │        └── *.AppImage              │
                                        └───────────────────────────────────┘

构建机器 (Windows / macOS)                         更新服务器 (47.57.241.17)
┌──────────────────┐   paramiko 上传产物 + latest.json  ┌───────────────────────┐
│ pnpm installer:  │ ─────────────────────────────────→ │ /var/www/             │
│   build          │   publish-update.py                │   openclaw-update/    │
└──────────────────┘                                    └───────────────────────┘
                                                      ↓ latest.json (元数据)
                                                    openclawcn.net/update/
                                                      ↓ 安装包文件
                                                    cdn.openclawcn.net/update/artifacts/
```

**关键配置文件：** `src-tauri/tauri.conf.json`

| 配置项                          | 值                                          | 说明                           |
| ------------------------------- | ------------------------------------------- | ------------------------------ |
| `version`                       | 当前版本号                                  | 客户端用于对比是否需要更新     |
| `plugins.updater.endpoints`     | `https://openclawcn.net/update/latest.json` | 更新检查端点                   |
| `plugins.updater.pubkey`        | minisign 公钥（Base64）                     | 验证安装包签名                 |
| `bundle.createUpdaterArtifacts` | `true`                                      | 构建时自动生成 `.sig` 签名文件 |

---

## 环境准备（一次性）

### 1. 本地构建环境

**必需工具：**

| 工具                 | 最低版本 | 安装方式                                 |
| -------------------- | -------- | ---------------------------------------- |
| Node.js              | >= 22    | [nodejs.org](https://nodejs.org/)        |
| pnpm                 | 最新     | `npm install -g pnpm`                    |
| Rust (rustc + cargo) | stable   | [rustup.rs](https://rustup.rs/)          |
| cargo-tauri          | 2.x      | `cargo install tauri-cli --version "^2"` |
| Python 3             | >= 3.7   | 发布脚本需要                             |
| paramiko (Python 包) | 最新     | `pip install paramiko`                   |

**Windows 额外说明：**

- NSIS 由 Tauri 自动下载，无需手动安装
- `.npmrc` 中已配置 `registry=https://registry.npmmirror.com` 加速 npm 下载
- 发布脚本使用 Python + paramiko，无需 jq 或 bash 4+

### 2. minisign 签名密钥

密钥已生成并保存在 `~/.tauri/openclaw.key`（私钥）和 `~/.tauri/openclaw.key.pub`（公钥）。

> **如果需要重新生成：**
>
> ```bash
> # 必须指定 --password，空密码在 Windows PowerShell 下无法正确传递
> cargo tauri signer generate -w ~/.tauri/openclaw.key --password <你的密码> --force
> ```
>
> 重新生成后，必须将新的公钥内容更新到 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 字段。

**安全注意事项：**

- 私钥 `~/.tauri/openclaw.key` **绝对不能**提交到 Git
- 如果在多台机器上构建，需要将同一份私钥复制到每台机器的 `~/.tauri/` 目录
- 公钥和私钥必须配对，否则客户端验签会失败
- ⚠️ **必须设置密码**：空密码在 Windows PowerShell 中会导致签名失败（"Wrong password" 错误）
- 构建时通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量传入私钥密码；不要把真实密码写进文档、脚本或 Git

### 3. 服务器初始化（已完成）

更新服务器 `47.57.241.17`（openclawcn.net）已配置完毕：

- `/var/www/openclaw-update/` 目录已创建
- `/var/www/openclaw-update/artifacts/` 目录已创建
- Nginx `/update/` location 已添加到 `openclawcn.net` 站点配置
- `latest.json` 占位文件已就位

如需在新服务器上重新部署：

```bash
# 步骤 1: 创建目录和占位文件
ssh root@openclawcn.net 'bash -s' < scripts/setup-update-server.sh

# 步骤 2: 配置 Nginx（主域名 /update/ location）
scp scripts/deploy-update-nginx.sh root@openclawcn.net:/tmp/
ssh root@openclawcn.net 'bash /tmp/deploy-update-nginx.sh'

# 步骤 3: 配置 CDN 子域名（安装包下载加速）
ssh root@openclawcn.net 'bash -s' < scripts/deploy-cdn-nginx.sh
```

> **CDN 架构说明：**
>
> - `openclawcn.net/update/latest.json` — 更新元数据（版本号、签名），由原服务器直接提供
> - `cdn.openclawcn.net/update/artifacts/` — 安装包二进制文件，通过 CDN 分发加速下载
> - 当前 `cdn.openclawcn.net` 临时指向原服务器 `43.99.16.221`，后续切换 DNS 即可无缝迁移到真正的 CDN

---

## 每次发版流程

### 步骤 1：更新版本号

需要同步修改两个文件中的版本号（**必须一致**）：

**`src-tauri/tauri.conf.json`：**

```json
"version": "0.3.0"
```

**`src-tauri/Cargo.toml`：**

```toml
version = "0.3.0"
```

> 新版本号必须严格大于当前已发布版本，否则客户端不会触发更新。
> `Cargo.lock` 会在下次构建时自动同步，无需手动修改。

### 步骤 2：提交并打 Tag

```bash
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "release: v0.3.0"
git tag v0.3.0
git push && git push --tags
```

> ⚠️ 如果构建过程中需要修改配置并 `git commit --amend`，之后推送时需加 `--force`：
>
> ```bash
> git push --force && git push --tags --force
> ```

### 步骤 3：构建签名安装包

#### Windows（由于集成了构建脚本，无需每次设置环境）

执行方式：

1. 在 PowerShell/Terminal 中执行 `.\build.ps1`。

> 💡 **提示**：`build.ps1` 会自动设置 `BUILD_CONFIG=release` 环境变量，并从 `~/.tauri/openclaw.key` 读取私钥设置环境变量，同时自带 `cargo clean` 机制以确保产物完全无幽灵缓存。
>
> 说明：请统一使用 `build.ps1`；它会通过 PowerShell 的 `ReadAllText()` 读取完整的多行私钥，避免批处理脚本读取首行导致签名失败。

#### macOS（在 Mac 机器上执行）

```bash
# 设置签名环境变量
export SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/openclaw.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<你的 minisign 私钥密码>"

# 构建 Apple Silicon (M 系列) 版本
pnpm installer:build:mac-arm

# 构建 Intel 版本
pnpm installer:build:mac-intel
```

**架构选择说明：**

- `mac-arm`: 仅 Apple Silicon (M1/M2/M3)，体积最小，推荐 M 系列用户
- `mac-intel`: 仅 Intel x86_64，适用于旧款 Mac
- 当前发版流程按架构分别构建、分别签名、分别公证；不再使用 Universal 包

**构建脚本自动完成：** 环境检查 → 下载 Node.js 运行时 → `cargo tauri build`（自动执行 `beforeBuildCommand` = `prepare-gateway-bundle.js`，内含 UI 构建 + gateway 代码打包） → Cargo 编译并嵌入 `dist/control-ui/` → 收集产物到 `dist/installers/`

> ⚠️ `pnpm installer:build` 在 **release** 模式下会对签名环境变量做 fail-fast 检查；如果缺少 `TAURI_SIGNING_PRIVATE_KEY`（或加密私钥缺少 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），脚本会直接退出，而不是继续产出无法发布自动更新的半成品。
> ⚠️ 在 macOS 上，release 构建还必须显式指定 `--target aarch64-apple-darwin` 或 `--target x86_64-apple-darwin`；脚本会直接拒绝未指定 target 或 `universal-apple-darwin` 的旧流程。
> ⚠️ **首次构建或修改前端代码/配置后**，建议先清除 Cargo 编译缓存再构建：
>
> ```bash
> cd src-tauri; cargo clean; cd ..
> pnpm installer:build:mac-arm
> pnpm installer:build:mac-intel
> ```
>
> 原因：Tauri 的 `generate_context!()` proc macro 会在编译时嵌入 `frontendDist` 目录中的所有文件。
> Cargo 增量编译可能复用旧的宏展开结果，导致前端资源未更新。

#### 构建产物

| 平台          | 原始路径                                                      | 产物文件                          |
| ------------- | ------------------------------------------------------------- | --------------------------------- |
| Windows       | `src-tauri/target/release/bundle/nsis/`                       | `*_x64-setup.exe` + `.sig`        |
| macOS (ARM)   | `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/` | `*.app` + `*.app.tar.gz` + `.sig` |
| macOS (ARM)   | `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`   | `*_aarch64.dmg`                   |
| macOS (Intel) | `src-tauri/target/x86_64-apple-darwin/release/bundle/macos/`  | `*.app` + `*.app.tar.gz` + `.sig` |
| macOS (Intel) | `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/`    | `*_x64.dmg`                       |
| Linux         | `src-tauri/target/release/bundle/appimage/`                   | `*.AppImage` + `.sig`             |

所有产物会被自动复制到 `dist/installers/` 目录。
其中 macOS 的 updater 产物在复制时会追加架构后缀（如 `OpenClaw桌面版_aarch64.app.tar.gz`），避免 ARM / Intel 两次构建互相覆盖。

**macOS 产物说明：**

- `.app`：签名、公证、staple 操作的原始应用 bundle，位于 `bundle/macos/` 目录
- `.app.tar.gz` + `.sig`：Tauri 自动更新实际使用的产物，需在 `.app` 完成 staple 后重新打包/重新签名
- `.dmg`：官网下载使用的安装包，位于 `bundle/dmg/` 目录
- `publish-update.py` 会自动收集 `.app.tar.gz`、`.sig` 和 `.dmg`

> **注意：** `tauri.conf.json` 中 `bundle.targets` 设为 `["app", "dmg", "nsis"]`，会同时构建 .app、.dmg 和 NSIS 安装包。
> MSI 构建在 Windows 上会因中文路径（WiX 不支持 Unicode 产品名）而失败，所以不包含 MSI。

### 步骤 4：macOS 代码签名与公证

> 此步骤仅 macOS 需要。Windows 版本暂无代码签名，可跳过。

构建完成后，需要对 macOS 产物进行 Apple 代码签名和公证，否则用户安装时会提示"无法验证开发者"。

```bash
# 以 ARM 版本为例（Intel 时将 TARGET 改为 x86_64-apple-darwin，ARCH_SUFFIX 改为 x64）
export SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/openclaw.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<你的 minisign 私钥密码>"

VERSION="0.3.0"
TARGET="aarch64-apple-darwin"
ARCH_SUFFIX="aarch64"
BUNDLE_DIR="src-tauri/target/${TARGET}/release/bundle"
APP_NAME="OpenClaw桌面版.app"
APP_PATH="${BUNDLE_DIR}/macos/${APP_NAME}"
APP_TAR="${BUNDLE_DIR}/macos/${APP_NAME}.tar.gz"
APP_ZIP="/tmp/${APP_NAME%.app}-${ARCH_SUFFIX}.zip"
DMG_PATH="${BUNDLE_DIR}/dmg/OpenClaw桌面版_${VERSION}_${ARCH_SUFFIX}.dmg"

# 1. 使用 Developer ID Application 证书对 .app 深度签名
scripts/codesign-mac-app.sh "$APP_PATH"

# 2. 严格校验签名，再查看详情
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH"

# 3. 先对 .app 单独做 notarization，并在通过后 staple .app 本体
rm -f "$APP_ZIP"
ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"
STAPLE_APP_PATH="$APP_PATH" scripts/notarize-mac-artifact.sh "$APP_ZIP"
xcrun stapler validate "$APP_PATH"

# 4. 用已经 staple 的 .app 重新打包 updater 用的 .app.tar.gz
rm -f "$APP_TAR" "${APP_TAR}.sig"
tar -czf "$APP_TAR" -C "${BUNDLE_DIR}/macos" "$APP_NAME"

# 5. 重新生成 updater 的 minisign 签名
cargo tauri signer sign "$APP_TAR" -f ~/.tauri/openclaw.key -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"

# 6. 用已经 staple 的 .app 重新生成 DMG（用于官网下载）
#    这里复用 Tauri bundler 的 DMG 脚本和默认布局参数，保留 App 图标位置、Applications 拖拽链接和卷图标
rm -f "$DMG_PATH"
"$BUNDLE_DIR/dmg/bundle_dmg.sh" \
  --volname "OpenClaw桌面版" \
  --icon "$APP_NAME" 180 170 \
  --app-drop-link 480 170 \
  --window-size 660 400 \
  --hide-extension "$APP_NAME" \
  --volicon "$BUNDLE_DIR/dmg/icon.icns" \
  "$DMG_PATH" \
  "$APP_PATH"

# 7. 对 DMG 做 notarization，并 staple DMG 本身
scripts/notarize-mac-artifact.sh "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"

# 8. 最终 Gatekeeper 验证
spctl -a -vvv -t execute "$APP_PATH"
spctl -a -vvv -t open "$DMG_PATH"
```

**注意：**

- Tauri 自动更新下载的是 `.app.tar.gz`，不是 `.dmg`
- `.app.tar.gz` 本身不会向 Apple 单独提交公证；正确做法是先公证并 staple 其中的 `.app`，再重新打包 `.app.tar.gz` 并重新生成 `.sig`
- `.dmg` 仍需单独公证并 staple，因为官网下载走的是 DMG 分发链路
- 当前仓库未在 `tauri.conf.json` 中自定义 DMG 背景图或窗口位置，上面的 `bundle_dmg.sh` 参数使用的是 Tauri 默认布局：app 图标 `(180,170)`、Applications 链接 `(480,170)`、窗口大小 `660x400`

### 步骤 5：发布到更新服务器

#### 方式 A：使用脚本（推荐）

```bash
# 如未安装 paramiko，先安装
pip install paramiko

# 发布（会交互式输入 SSH 密码，只需输一次）
python scripts/publish-update.py 0.3.0
```

也可通过环境变量传入密码（CI 场景）：

```bash
DEPLOY_SSH_PASSWORD=xxx python scripts/publish-update.py 0.3.0
```

脚本自动完成：

1. 扫描构建产物目录（包括 `src-tauri/target/release/bundle/` 和跨架构目录如 `src-tauri/target/aarch64-apple-darwin/release/bundle/`）
2. 通过 HTTPS 获取服务器现有的 `latest.json`，如果版本号相同则**合并**平台条目（不会覆盖其他平台）
3. 读取 `.sig` 签名内容，生成/更新 `latest.json`（纯 Python，不依赖 jq）
4. paramiko 单连接：mkdir → sftp 上传所有产物 → sftp 上传 latest.json

> ⚠️ 如果服务器上已存在 `latest.json`，但脚本无法成功拉取或解析它，脚本会直接报错退出，而不是静默重建一个新的 `latest.json`。
> 只有服务器返回 `404`（首次发布/文件不存在）时，脚本才会创建全新 `latest.json`。

> **跨平台发布时**，可以在各自机器上分别运行 `publish-update.py`（版本号保持一致），
> 脚本会自动合并已有的平台条目。例如：先在 Windows 上发布（写入 `windows-x86_64`），
> 再在 macOS 上发布（追加 `darwin-aarch64` 和 `darwin-x86_64`，保留 `windows-x86_64`）。

#### 方式 B：手动操作

**1) 上传安装包到服务器**

```powershell
scp "src-tauri\target\release\bundle\nsis\OpenClaw桌面版_0.3.0_x64-setup.exe" root@47.57.241.17:/var/www/openclaw-update/artifacts/
```

**2) 读取签名内容**

```powershell
$sig = Get-Content "src-tauri\target\release\bundle\nsis\OpenClaw桌面版_0.3.0_x64-setup.exe.sig" -Raw
Write-Host $sig
```

> ⚠️ 这里请使用**精确文件名**，不要用 `*setup.exe` 或 `*setup.exe.sig` 这类通配符；如果目录里残留旧版本产物，通配符很容易读错文件。

**3) 在服务器上写入 latest.json**

```bash
ssh root@47.57.241.17

cat > /var/www/openclaw-update/latest.json << 'EOF'
{
  "version": "0.3.0",
  "notes": "v0.3.0 更新说明",
  "pub_date": "2026-03-01T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_x64-setup.exe",
      "signature": "粘贴 .sig 文件的完整内容"
    }
  }
}
EOF
```

### 步骤 6：更新官网下载链接

修改 `openclawcn_web/src/app/page.tsx` 中的版本号和文件名：

```tsx
// 找到 Windows 下载按钮，更新 href 和按钮文字中的版本号
href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_x64-setup.exe"
下载 Windows 版 (v0.3.0)
```

**macOS 下载链接：** 需要提供两个版本（Apple Silicon 和 Intel）：

```tsx
// macOS Apple Silicon (M1/M2/M3)
<a
  href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_aarch64.dmg"
  className="...（复制 Windows 按钮的 className）"
>
  下载 macOS 版 - Apple Silicon (v0.3.0)
</a>

// macOS Intel
<a
  href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_x64.dmg"
  className="...（复制 Windows 按钮的 className）"
>
  下载 macOS 版 - Intel (v0.3.0)
</a>
```

然后部署官网（静态导出，无需 PM2）：

```bash
cd openclawcn_web
npm run build
python deploy.py upload
```

最后提交官网改动：

```bash
cd ..
git add openclawcn_web/src/app/page.tsx
git commit -m "chore: update website download link to v0.3.0"
git push
```

### 步骤 7：验证

```bash
# 检查 latest.json 可访问且内容正确
curl https://openclawcn.net/update/latest.json

# 检查安装包可下载（替换为实际文件名）
curl -I "https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_x64-setup.exe"
```

确认：

- `version` 字段为新版本号
- `signature` 字段不为空
- 安装包 URL 返回 200

### 步骤 8：端到端测试

1. 安装**旧版本**（当前已发布的版本）
2. 启动应用，等待 15 秒后应出现更新横幅；或进入「系统设置 → 软件更新」手动检查
3. 点击"立即更新"，确认下载进度条正常
4. 下载完成后点击"立即重启"，确认更新后版本号正确

---

## 自动更新机制

### 更新检查时机

| 场景         | 时间                                              |
| ------------ | ------------------------------------------------- |
| 首次检查     | 启动后 **15 秒**（等待 CPU 空闲，最多再等 30 秒） |
| 定期检查     | 每 **4 小时**                                     |
| 检查失败重试 | **30 分钟**后重试一次，之后恢复 4 小时周期        |
| 手动检查     | 用户在「系统设置 → 软件更新」点击"检查更新"       |

### 更新流程（用户视角）

```
启动 App
  │
  ├─ 15s 后自动检查 ─── 无更新 ──→ 4小时后再查
  │                  │
  │                  └── 发现新版本
  │                       │
  │                       ▼
  │                  显示更新横幅
  │                  "发现新版本 vX.Y.Z"
  │                  [立即更新]  [✕]
  │                       │        │
  │                       │        └── 用户关闭 → 下次启动 App 再提醒（或在设置页手动检查）
  │                       ▼
  │                  下载安装包（显示进度条）
  │                       │
  │                       ▼
  │                  下载完成
  │                  "更新已下载完成，重启后生效"
  │                  [立即重启]  [稍后]
  │                       │        │
  │                       │        └── 用户继续使用，下次启动生效
  │                       ▼
  │                  重启应用，更新完成
```

### 更新安全机制

1. **签名验证**：客户端使用内置的 minisign 公钥验证 `.sig` 签名，确保安装包未被篡改
2. **HTTPS**：更新端点和下载链接均通过 HTTPS（Let's Encrypt 证书）
3. **Rust 侧请求**：所有 HTTP 请求由 Tauri 的 Rust 后端（reqwest）发起，不经过 WebView

### 更新不触发的常见原因

| 原因                                              | 排查方法                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `latest.json` 中的 `version` 不大于客户端当前版本 | `curl` 检查 `latest.json`                                         |
| `.sig` 签名与安装包不匹配                         | 确认构建时设置了正确的 `TAURI_SIGNING_PRIVATE_KEY`                |
| 公钥不匹配                                        | 比对 `tauri.conf.json` 的 `pubkey` 与 `~/.tauri/openclaw.key.pub` |
| 网络不通                                          | 客户端能否访问 `openclawcn.net`                                   |
| 缓存                                              | 服务器已设置 `Cache-Control: no-cache`，正常不会有此问题          |

---

## latest.json 格式参考

```json
{
  "version": "0.3.0",
  "notes": "更新说明（显示在更新横幅和设置页中）",
  "pub_date": "2026-03-01T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_x64-setup.exe",
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
    },
    "darwin-aarch64": {
      "url": "https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_aarch64.app.tar.gz",
      "signature": "..."
    },
    "darwin-x86_64": {
      "url": "https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_x64.app.tar.gz",
      "signature": "..."
    },
    "linux-x86_64": {
      "url": "https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_amd64.AppImage",
      "signature": "..."
    }
  }
}
```

**字段说明：**

| 字段                    | 必需 | 说明                                                 |
| ----------------------- | ---- | ---------------------------------------------------- |
| `version`               | 是   | 语义化版本号，必须大于客户端当前版本                 |
| `notes`                 | 是   | 更新说明，显示在客户端的更新横幅中                   |
| `pub_date`              | 是   | ISO 8601 UTC 时间                                    |
| `platforms`             | 是   | 各平台的下载信息，key 为 Tauri 平台标识              |
| `platforms.*.url`       | 是   | 安装包下载 URL（HTTPS）                              |
| `platforms.*.signature` | 是   | `.sig` 文件的完整内容（Base64 编码的 minisign 签名） |

> 只需填写本次构建的目标平台，其他平台可省略。
> 例如只发 Windows 版，`platforms` 中只需 `windows-x86_64`。

**Tauri 平台标识：**

| 标识             | 对应平台                       |
| ---------------- | ------------------------------ |
| `windows-x86_64` | Windows 64 位                  |
| `darwin-aarch64` | macOS Apple Silicon (M1/M2/M3) |
| `darwin-x86_64`  | macOS Intel                    |
| `linux-x86_64`   | Linux 64 位                    |

> macOS 同时发布 Apple Silicon (aarch64) 和 Intel (x86_64) 两个版本。
> 用户根据自己的 Mac 型号选择对应版本下载。

---

## 服务器维护

### 服务器信息

| 项目           | 值                                          |
| -------------- | ------------------------------------------- |
| IP             | `47.57.241.17`                              |
| 域名           | `openclawcn.net`                            |
| SSH            | `root@47.57.241.17`                         |
| 更新文件根目录 | `/var/www/openclaw-update/`                 |
| Nginx 站点配置 | `/etc/nginx/sites-available/openclawcn.net` |
| SSL 证书       | Let's Encrypt，自动续期                     |

### Nginx 更新路由配置

```nginx
# 已配置在 /etc/nginx/sites-available/openclawcn.net 的 SSL server block 中

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
```

### 清理旧版本产物

发布多个版本后，`/var/www/openclaw-update/artifacts/` 目录会积累旧安装包。可定期清理：

```bash
ssh root@47.57.241.17

# 查看当前占用
du -sh /var/www/openclaw-update/artifacts/*

# 删除旧版本文件（保留最新版本）
# 注意：不要删除 latest.json 中引用的文件
rm /var/www/openclaw-update/artifacts/OpenClaw桌面版_0.2.0_*
```

---

## macOS 代码签名与公证（一次性设置）

macOS 应用需要经过代码签名和 Apple 公证才能让用户顺利安装（否则会提示"无法验证开发者"）。

### 前置条件

- Apple Developer Program 会员（$99/年）
- macOS 系统 + Xcode Command Line Tools

### 1. 创建 Developer ID Application 证书

1. 登录 [Apple Developer](https://developer.apple.com/account)
2. 进入 **Certificates, Identifiers & Profiles** → **Certificates**
3. 点击 **+** 创建新证书
4. 选择 **Developer ID Application**（用于分发给 Mac App Store 以外的用户）
5. 选择 **G2 Sub-CA**（Xcode 11.4.1 or later）
6. 按提示在 Keychain Access 中创建 CSR（Certificate Signing Request）：
   - 打开 **钥匙串访问** → 菜单 **钥匙串访问** → **证书助理** → **从证书颁发机构请求证书**
   - 填写邮箱，选择"存储到磁盘"
7. 上传 CSR，下载生成的 `.cer` 文件
8. 双击 `.cer` 文件安装到 Keychain（如果提示权限问题，拖到"登录"钥匙串）

### 2. 验证证书安装

```bash
# 查看已安装的签名证书
security find-identity -p codesigning -v

# 应该看到类似输出：
# 1) ABCD1234... "Developer ID Application: Your Name (TEAMID)"
```

### 3. 创建 App Store Connect API 密钥（用于公证）

1. 登录 [App Store Connect](https://appstoreconnect.apple.com)
2. 进入 **用户和访问** → **密钥** → **App Store Connect API** → **个人密钥**
3. 点击 **+** 创建新密钥，权限选择 **Developer** 或 **管理**
4. 下载 `.p8` 密钥文件（只能下载一次！）
5. 记录 **Key ID** 和页面顶部的 **Issuer ID**

### 4. 配置环境变量

```bash
# 创建密钥目录并移动 .p8 文件
mkdir -p ~/.apple-keys
mv ~/Downloads/AuthKey_*.p8 ~/.apple-keys/

# 在 ~/.zshrc 中添加（替换为你的实际值）
cat >> ~/.zshrc << 'EOF'

# Apple 公证 API 密钥
export NOTARYTOOL_KEY="$HOME/.apple-keys/AuthKey_XXXXXX.p8"
export NOTARYTOOL_KEY_ID="XXXXXX"
export NOTARYTOOL_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
EOF

source ~/.zshrc
```

> **安全提示**：`.p8` 密钥文件应妥善保管，不要提交到 Git。

也可以使用 `notarytool` 的 Keychain profile（更适合长期使用）：

```bash
xcrun notarytool store-credentials "openclaw-notary" \
  --key "$HOME/.apple-keys/AuthKey_XXXXXX.p8" \
  --key-id "XXXXXX" \
  --issuer "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

export NOTARYTOOL_PROFILE="openclaw-notary"
```

> 配置了 `NOTARYTOOL_PROFILE` 后，`scripts/notarize-mac-artifact.sh` 会优先使用它，而不是直接读取 `.p8` 路径。

### 签名脚本说明

| 脚本                               | 用途                                           |
| ---------------------------------- | ---------------------------------------------- |
| `scripts/codesign-mac-app.sh`      | 对 .app 进行深度签名（含 Frameworks、Sparkle） |
| `scripts/notarize-mac-artifact.sh` | 提交到 Apple 公证服务并 staple                 |

**codesign-mac-app.sh 环境变量：**

- `SIGN_IDENTITY`: 指定签名证书；正式发版时应显式设为 `Developer ID Application: ...`
- `CODESIGN_TIMESTAMP`: 时间戳模式，`auto`（默认）/`on`/`off`
- `DISABLE_LIBRARY_VALIDATION`: 设为 `1` 可跳过库验证，仅开发调试用

**notarize-mac-artifact.sh 环境变量：**

- `NOTARYTOOL_KEY`: App Store Connect API 密钥 `.p8` 路径
- `NOTARYTOOL_KEY_ID`: API Key ID
- `NOTARYTOOL_ISSUER`: API Issuer ID
- `STAPLE_APP_PATH`: 公证后要 staple 的 `.app` 路径

### 常见问题

- `errSecInternalComponent`
  原因：Keychain 访问权限问题
  解决：在 Keychain Access 中解锁登录钥匙串
- `The signature is invalid`
  原因：签名后修改了 app 内容
  解决：重新签名
- `rejected (the code signature is invalid)`
  原因：签名不完整或证书问题
  解决：检查证书是否过期，重新深度签名
- 公证失败 `Invalid signature`
  原因：未启用 hardened runtime
  解决：脚本默认启用，检查是否手动覆盖了选项
- 公证超时
  原因：Apple 服务器繁忙
  解决：稍后重试，或检查 [Apple 系统状态](https://developer.apple.com/system-status/)

---

## Windows 代码签名（后续）

当前没有 Windows 代码签名证书，用户安装时会看到 SmartScreen 警告。

### 获取证书

- 购买 OV/EV 代码签名证书（DigiCert / Sectigo / GlobalSign，约 $200-600/年）
- 在 `tauri.conf.json` 中配置 `bundle.windows.certificateThumbprint`
- EV 证书可立即消除 SmartScreen 警告；OV 证书需积累信誉

---

## 故障排查

### 构建相关

| 问题                                                 | 原因                                               | 解决                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 构建在环境检查初筛阶段直接报错退出，提示"未设置私钥" | 未设置私钥环境变量                                 | 请使用根目录提供的 `build.ps1` 脚本进行一键构建，它会自动读取并设置密钥。                                |
| NSIS 打包后报 "Wrong password"                       | 签名密钥密码不对或 PowerShell 读取密钥时添加了 BOM | 使用 `build.ps1` 脚本可以自动规避由于 BOM 或者编码错误导致的密码截断等故障。                             |
| NSIS 打包后报 "no private key"                       | 未读取到私钥内容或路径设置错误                     | 推荐直接运行 `build.ps1` 以自动完成配置绑定。                                                            |
| 构建卡住在 `Running makensis`                        | gateway-bundle 太大（>1GB）                        | 检查 `prepare-gateway-bundle.js` 的去重和清理步骤是否正常执行                                            |
| 构建卡住在 WebView2 下载                             | 网络无法访问 Microsoft CDN                         | `tauri.conf.json` 已设置 `webviewInstallMode: skip`                                                      |
| `cargo-lock` 文件锁定错误                            | Windows Defender 实时监控                          | 将项目目录加入排除列表                                                                                   |
| `beforeBuildCommand` 失败                            | `pnpm install` 未执行                              | 先运行 `pnpm install`                                                                                    |
| 安装后白屏 "No resource with given URL found"        | Cargo 增量编译跳过前端资源嵌入                     | `build.rs` 已添加 `rerun-if-changed=../dist/control-ui`；如仍复现可 `cargo clean` 后重建                 |
| 安装后白屏但 Gateway 手动可启动                      | `frontendDist` 指向的目录缺少 UI 构建产物          | 已修复：`frontendDist` 直接指向 `../dist/control-ui`（Vite 输出），splash 通过 Rust `window.eval()` 注入 |

### 发布相关

| 问题                                              | 原因                   | 解决                                            |
| ------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| `ModuleNotFoundError: No module named 'paramiko'` | 未安装 paramiko        | `pip install paramiko`                          |
| SSH 连接超时                                      | 网络不通或服务器防火墙 | 检查网络，确认 22 端口可达                      |
| 上传中文文件名乱码                                | 终端编码问题           | Python + paramiko SFTP 不受此影响，正常使用即可 |

### 客户端更新相关

| 问题               | 原因                               | 解决                                 |
| ------------------ | ---------------------------------- | ------------------------------------ |
| 客户端检测不到更新 | `latest.json` 版本号不大于当前版本 | 检查 `latest.json` 的 `version` 字段 |
| 下载后验签失败     | 密钥对不匹配或 `.sig` 内容损坏     | 重新构建并确保使用正确的私钥         |
| 更新横幅不出现     | 用户之前点了关闭                   | 去「系统设置 → 软件更新」手动检查    |

### 安装后 Gateway 启动相关

| 问题                                        | 原因                                                             | 解决                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 白屏 + "Gateway 启动超时"                   | Gateway 进程崩渍或启动过慢（>60秒），多种可能原因                | 桌面端已宽限到 60 秒启动，若仍复现请运行 gateway 看报错                                                                                    |
| `EISDIR: lstat 'C:'`                        | Tauri `resource_dir()` 返回 `\\?\` 前缀路径，Node.js 无法解析    | `main.rs` 已修复：strip `\\?\` 前缀                                                                                                        |
| `Cannot find module 'xxx'` (extension 依赖) | extension 的 npm 依赖未安装到 `gateway-bundle/node_modules/`     | `prepare-gateway-bundle.js` 已修复：合并到根 package.json                                                                                  |
| `Cannot find module '../doc/xxx'`           | Step 7 清理误删了 npm 包内的 `doc/` 目录                         | 已修复：`doc` 从 `dirsToRemove` 中移除                                                                                                     |
| 扩展原生模块加载失败 (如缺失 .node 二进制)  | 打包时 npm 遵循了 `.npmrc` 中 `allow-build-scripts` 的白名单限制 | **必须补充：**在项目根目录 `.npmrc` 的 `allow-build-scripts` 字段，手动将该依赖包名加入白名单，以允许其执行 `postinstall` 脚本下载底层文件 |

**诊断命令**：手动启动 gateway 查看完整错误输出：

```powershell
# 找到安装目录
$appDir = (Get-ChildItem "$env:LOCALAPPDATA","$env:ProgramFiles" -Filter "openclaw-desktop.exe" -Recurse -ErrorAction SilentlyContinue | Select -First 1).DirectoryName

# 手动运行 gateway
& "$appDir\node-runtime\win-x64\node.exe" "$appDir\gateway-bundle\openclaw.mjs" gateway --port 28789 --force
```

---

## 相关文件索引

### 配置文件

| 文件                                  | 用途                                           |
| ------------------------------------- | ---------------------------------------------- |
| `src-tauri/tauri.conf.json`           | 版本号、更新端点、签名公钥、CSP 安全策略       |
| `src-tauri/Cargo.toml`                | Rust crate 版本号（需与 tauri.conf.json 同步） |
| `src-tauri/capabilities/default.json` | Tauri 权限配置（含 `updater:default`）         |

### 构建脚本

- `scripts/build-installer.js`: 统一构建入口（环境检查→依赖→构建→收集产物）
- `scripts/prepare-gateway-bundle.js`: `beforeBuildCommand`，打包 gateway 代码（含 UI 构建、依赖安装）
- `scripts/download-node.js`: 下载 Node.js 运行时嵌入安装包
- `.npmrc`: npm 注册表镜像（`registry.npmmirror.com`）+ 允许构建脚本列表

### 发布脚本

| 文件                             | 用途                                                |
| -------------------------------- | --------------------------------------------------- |
| `scripts/publish-update.py`      | 一键发布（收集产物→生成 latest.json→paramiko 上传） |
| `scripts/setup-update-server.sh` | 服务器目录初始化（一次性）                          |
| `scripts/deploy-update-nginx.sh` | 服务器 Nginx 配置部署（一次性）                     |
| `scripts/deploy-cdn-nginx.sh`    | CDN 子域名 Nginx 配置 + SSL（一次性）               |

### 前端代码

| 文件                                        | 用途                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `src-tauri/src/main.rs`                     | Splash 启动画面（通过 `window.eval()` 注入）+ gateway token 传递 |
| `ui/src/ui/views/updater.ts`                | 自动更新核心模块（检查→横幅→下载→重启）                          |
| `ui/src/ui/views/config-system-settings.ts` | 「软件更新」设置卡片（手动检查入口）                             |

### 官网

| 文件                              | 用途                                               |
| --------------------------------- | -------------------------------------------------- |
| `openclawcn_web/src/app/page.tsx` | 官网首页（含下载链接，每次发版需更新版本号）       |
| `openclawcn_web/deploy.py`        | 官网部署脚本（upload / nginx / certbot，静态导出） |

### 签名密钥

| 文件                        | 用途                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `~/.tauri/openclaw.key`     | minisign 私钥（**不可泄露，不可提交 Git**）                    |
| `~/.tauri/openclaw.key.pub` | minisign 公钥（内容需与 `tauri.conf.json` 中的 `pubkey` 一致） |

### macOS 签名脚本

| 文件                               | 用途                                              |
| ---------------------------------- | ------------------------------------------------- |
| `scripts/codesign-mac-app.sh`      | 对 .app 进行深度签名（含 Frameworks、Sparkle 等） |
| `scripts/notarize-mac-artifact.sh` | 提交到 Apple 公证服务并 staple                    |

### macOS 签名密钥（本地）

| 文件/位置                    | 用途                                                 |
| ---------------------------- | ---------------------------------------------------- |
| Keychain 中的证书            | Developer ID Application 证书（用于代码签名）        |
| `~/.apple-keys/AuthKey_*.p8` | App Store Connect API 密钥（用于公证，**不可泄露**） |
