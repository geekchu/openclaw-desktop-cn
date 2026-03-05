# OpenClaw 桌面版 — 发版流程

## 目录

- [架构概览](#架构概览)
- [环境准备（一次性）](#环境准备一次性)
- [每次发版流程](#每次发版流程)
- [自动更新机制](#自动更新机制)
- [latest.json 格式参考](#latestjson-格式参考)
- [服务器维护](#服务器维护)
- [代码签名（后续）](#代码签名后续)
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

构建机器 (Windows / macOS)                         更新服务器 (8.223.32.138)
┌──────────────────┐   scp 上传产物 + latest.json   ┌───────────────────────┐
│ pnpm installer:  │ ─────────────────────────────→ │ /var/www/             │
│   build          │   publish-update.sh            │   openclaw-update/    │
└──────────────────┘                                └───────────────────────┘
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
| Node.js              | >= 22    | https://nodejs.org/                      |
| pnpm                 | 最新     | `npm install -g pnpm`                    |
| Rust (rustc + cargo) | stable   | https://rustup.rs/                       |
| cargo-tauri          | 2.x      | `cargo install tauri-cli --version "^2"` |
| jq (原生版)          | 任意     | 发布脚本需要，见下方说明                 |

**Windows 额外说明：**

- NSIS 由 Tauri 自动下载，无需手动安装
- 推荐使用 Git Bash 运行发布脚本（`publish-update.sh` 需要 bash 4+ 的关联数组）
- ⚠️ **jq 必须安装原生版本**，npm 的 `jq` 包不可用。下载地址：https://github.com/jqlang/jq/releases
  将 `jq-windows-amd64.exe` 重命名为 `jq.exe` 放入 PATH 目录（如 Git Bash 的 `/usr/bin/`）
- `.npmrc` 中已配置 `registry=https://registry.npmmirror.com` 加速 npm 下载

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
- 当前密钥密码：`123`（构建时需要设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量）

### 3. 服务器初始化（已完成）

更新服务器 `8.223.32.138`（openclawcn.net）已配置完毕：

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
> - 当前 `cdn.openclawcn.net` 临时指向原服务器 `8.223.32.138`，后续切换 DNS 即可无缝迁移到真正的 CDN

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

#### Windows（在 Windows 机器上执行）

#### Windows（由于集成了构建脚本，无需每次设置环境）

有两种便捷方式：

1. **直接双击** 项目根目录下的 `build.bat`。
2. 或在 PowerShell/Terminal 中执行 `.\build.ps1`。

> 💡 **提示**：这几个脚本会自动从 `~/.tauri/openclaw.key` 读取私钥设置环境变量，并自带 `cargo clean` 机制以确保产物完全无幽灵缓存。

#### macOS（在 Mac 机器上执行）

```bash
# 设置签名环境变量
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/openclaw.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="123"

# 构建
pnpm installer:build
```

**构建脚本自动完成：** 环境检查 → `pnpm install` → 下载 Node.js 运行时 → `cargo tauri build`（自动执行 `beforeBuildCommand` = `prepare-gateway-bundle.js`，内含 Vite UI 构建 + gateway-bundle 打包） → Cargo 编译并嵌入 `dist/control-ui/` → 收集产物到 `dist/installers/`

> ⚠️ **首次构建或修改前端代码/配置后**，建议先清除 Cargo 编译缓存再构建：
>
> ```powershell
> cd src-tauri; cargo clean; cd ..
> pnpm installer:build
> ```
>
> 原因：Tauri 的 `generate_context!()` proc macro 会在编译时嵌入 `frontendDist` 目录中的所有文件。
> Cargo 增量编译可能复用旧的宏展开结果，导致前端资源未更新。

> ⚠️ 如果忘记设置 `TAURI_SIGNING_PRIVATE_KEY` 或 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，构建会在 NSIS 打包后签名阶段失败。
> 可以在构建完成后手动签名：`cargo tauri signer sign <exe路径> --private-key-path "$HOME\.tauri\openclaw.key" --password 123`

#### 构建产物

| 平台    | 原始路径                                    | 产物文件                   |
| ------- | ------------------------------------------- | -------------------------- |
| Windows | `src-tauri/target/release/bundle/nsis/`     | `*_x64-setup.exe` + `.sig` |
| macOS   | `src-tauri/target/release/bundle/macos/`    | `*.app.tar.gz` + `.sig`    |
| Linux   | `src-tauri/target/release/bundle/appimage/` | `*.AppImage` + `.sig`      |

所有产物会被自动复制到 `dist/installers/` 目录。

> **注意：** `tauri.conf.json` 中 `bundle.targets` 设为 `["nsis"]`（仅 NSIS），不构建 MSI。
> MSI 构建在 Windows 上会因中文路径（WiX 不支持 Unicode 产品名）而失败，且自动更新不需要 MSI。

### 步骤 4：发布到更新服务器

在 Windows 上需要在 Git Bash 中运行（脚本依赖 bash 4+ 关联数组和 `jq`）。

#### 方式 A：使用脚本（推荐）

```bash
# Windows 下先确保原生 jq 在 PATH 中（如果已配好可跳过）
export PATH="/c/Users/$USERNAME/AppData/Local/Microsoft/WinGet/Packages:$PATH"

bash scripts/publish-update.sh 0.3.0 root@8.223.32.138
```

脚本自动完成：

1. 扫描 `src-tauri/target/release/bundle/` 下各平台的安装包和 `.sig` 文件
2. 从服务器获取现有的 `latest.json`，如果版本号相同则**合并**平台条目（不会覆盖其他平台）
3. 读取 `.sig` 签名内容，生成/更新 `latest.json`
4. 通过 `scp` 上传安装包到服务器 `/var/www/openclaw-update/artifacts/`
5. 上传 `latest.json` 到服务器 `/var/www/openclaw-update/`

> **跨平台发布时**，可以在各自机器上分别运行 `publish-update.sh`（版本号保持一致），
> 脚本会自动合并已有的平台条目。例如：先在 Windows 上发布（写入 `windows-x86_64`），
> 再在 macOS 上发布（追加 `darwin-aarch64`，保留 `windows-x86_64`）。

#### 方式 B：手动操作

**1) 上传安装包到服务器**

```powershell
scp src-tauri\target\release\bundle\nsis\*setup.exe root@8.223.32.138:/var/www/openclaw-update/artifacts/
```

**2) 读取签名内容**

```powershell
$sig = Get-Content "src-tauri\target\release\bundle\nsis\*setup.exe.sig" -Raw
Write-Host $sig
```

**3) 在服务器上写入 latest.json**

```bash
ssh root@8.223.32.138

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

### 步骤 5：更新官网下载链接

修改 `openclawcn_web/src/app/page.tsx` 中的版本号和文件名：

```tsx
// 找到 Windows 下载按钮，更新 href 和按钮文字中的版本号
href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_x64-setup.exe"
下载 Windows 版 (v0.3.0)
```

**macOS 首次发版时（仅需操作一次）：** 将 disabled 按钮替换为真实下载链接：

```tsx
// 找到 macOS 区域的 <button disabled> ... macOS 版即将推出 </button>
// 替换为：
<a
  href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.3.0_aarch64.dmg"
  className="...（复制 Windows 按钮的 className）"
>
  下载 macOS 版 (v0.3.0)
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

### 步骤 6：验证

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

### 步骤 7：端到端测试

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
      "url": "https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版.app.tar.gz",
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

| 标识             | 对应平台                    |
| ---------------- | --------------------------- |
| `windows-x86_64` | Windows 64 位               |
| `darwin-aarch64` | macOS Apple Silicon（默认） |
| `linux-x86_64`   | Linux 64 位                 |

> macOS 当前仅发布 Apple Silicon (aarch64) 版本。Intel Mac 用户需手动下载安装。
> 如需支持 Intel Mac，可构建 universal binary（`cargo tauri build --target universal-apple-darwin`），
> 然后在 `publish-update.sh` 中同时添加 `darwin-x86_64` 条目。

---

## 服务器维护

### 服务器信息

| 项目           | 值                                          |
| -------------- | ------------------------------------------- |
| IP             | `8.223.32.138`                              |
| 域名           | `openclawcn.net`                            |
| SSH            | `root@8.223.32.138`                         |
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
ssh root@8.223.32.138

# 查看当前占用
du -sh /var/www/openclaw-update/artifacts/*

# 删除旧版本文件（保留最新版本）
# 注意：不要删除 latest.json 中引用的文件
rm /var/www/openclaw-update/artifacts/OpenClaw桌面版_0.2.0_*
```

---

## 代码签名（后续）

当前没有代码签名证书，用户安装时会看到平台安全警告：

| 平台    | 行为                                     | 解决方式                                |
| ------- | ---------------------------------------- | --------------------------------------- |
| Windows | SmartScreen 弹窗"Windows 已保护你的电脑" | 点击"更多信息" → "仍要运行"             |
| macOS   | 提示"无法验证开发者"                     | 右键 → 打开，或在「安全性与隐私」中允许 |

### 后续获取证书

**Windows (Authenticode)：**

- 购买 OV/EV 代码签名证书（DigiCert / Sectigo / GlobalSign，约 $200-600/年）
- 在 `tauri.conf.json` 中配置 `bundle.windows.certificateThumbprint`
- EV 证书可立即消除 SmartScreen 警告；OV 证书需积累信誉

**macOS (Developer ID)：**

- 加入 Apple Developer Program（$99/年）
- 创建 Developer ID Application 证书
- 使用项目中已有的 `scripts/codesign-mac-app.sh` 和 `scripts/notarize-mac-artifact.sh` 进行签名和公证

---

## 故障排查

### 构建相关

| 问题                                          | 原因                                               | 解决                                                                                                     |
| --------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 构建成功但没有 `.sig` 文件                    | 未设置私钥环境变量                                 | 请使用根目录提供的 `build.bat` 或 `build.ps1` 脚本进行一键构建，它们会自动读取并设置密钥。               |
| NSIS 打包后报 "Wrong password"                | 签名密钥密码不对或 PowerShell 读取密钥时添加了 BOM | 使用 `build.ps1` 脚本可以自动规避由于 BOM 或者编码错误导致的密码截断等故障。                             |
| NSIS 打包后报 "no private key"                | 未读取到私钥内容或路径设置错误                     | 推荐直接运行 `build.bat` 或 `build.ps1` 以自动完成配置绑定。                                             |
| 构建卡住在 `Running makensis`                 | gateway-bundle 太大（>1GB）                        | 检查 `prepare-gateway-bundle.js` 的去重和清理步骤是否正常执行                                            |
| 构建卡住在 WebView2 下载                      | 网络无法访问 Microsoft CDN                         | `tauri.conf.json` 已设置 `webviewInstallMode: skip`                                                      |
| `cargo-lock` 文件锁定错误                     | Windows Defender 实时监控                          | 将项目目录加入排除列表                                                                                   |
| `beforeBuildCommand` 失败                     | `pnpm install` 未执行                              | 先运行 `pnpm install`                                                                                    |
| 安装后白屏 "No resource with given URL found" | Cargo 增量编译跳过前端资源嵌入                     | `build.rs` 已添加 `rerun-if-changed=../dist/control-ui`；如仍复现可 `cargo clean` 后重建                 |
| 安装后白屏但 Gateway 手动可启动               | `frontendDist` 指向的目录缺少 UI 构建产物          | 已修复：`frontendDist` 直接指向 `../dist/control-ui`（Vite 输出），splash 通过 Rust `window.eval()` 注入 |

### 发布相关

| 问题                                                    | 原因                                     | 解决                                          |
| ------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `publish-update.sh` 报 `declare -A: not found`          | bash 版本过低                            | 使用 Git Bash（自带 bash 4+）                 |
| `jq: command not found` 或 `Cannot find module 'async'` | 未安装原生 jq，或 npm 的 jq 包拦截了命令 | 下载原生 jq.exe 放入 PATH，确保在 npm jq 之前 |
| scp 上传失败                                            | SSH 密钥未配置                           | 配置 SSH 密钥或使用密码                       |

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
& "$appDir\node-runtime\win-x64\node.exe" "$appDir\gateway-bundle\openclaw.mjs" gateway --port 18789 --force
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

| 文件                                | 用途                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `scripts/build-installer.js`        | 统一构建入口（环境检查→依赖→构建→收集产物）                                 |
| `scripts/prepare-gateway-bundle.js` | beforeBuildCommand，打包 gateway 代码（含 UI 构建、依赖去重、文件清理优化） |
| `scripts/download-node.js`          | 下载 Node.js 运行时嵌入安装包                                               |
| `.npmrc`                            | npm 注册表镜像（`registry.npmmirror.com`）+ 允许构建脚本列表                |

### 发布脚本

| 文件                             | 用途                                           |
| -------------------------------- | ---------------------------------------------- |
| `scripts/publish-update.sh`      | 一键发布（收集产物→生成 latest.json→scp 上传） |
| `scripts/setup-update-server.sh` | 服务器目录初始化（一次性）                     |
| `scripts/deploy-update-nginx.sh` | 服务器 Nginx 配置部署（一次性）                |
| `scripts/deploy-cdn-nginx.sh`    | CDN 子域名 Nginx 配置 + SSL（一次性）          |

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
