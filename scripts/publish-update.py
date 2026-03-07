#!/usr/bin/env python3
"""
OpenClaw 更新发布脚本 (Python + paramiko)

替代 publish-update.sh，解决 Windows 上 scp 多次输密码、jq 依赖、中文文件名编码等问题。

用法: python scripts/publish-update.py <版本号>
示例: python scripts/publish-update.py 0.3.0

前提条件:
1. 已完成 cargo tauri build（且设置了 TAURI_SIGNING_PRIVATE_KEY 环境变量）
2. 服务器已通过 setup-update-server.sh + deploy-update-nginx.sh 初始化
3. pip install paramiko（如未安装）
"""
import getpass
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

try:
    import paramiko
except ImportError:
    print("ERROR: paramiko 未安装。请运行: pip install paramiko")
    sys.exit(1)

# ── 常量 ──
HOST = "47.57.241.17"
USER = "root"
REMOTE_DIR = "/var/www/openclaw-update"
UPDATE_URL = "https://openclawcn.net/update/latest.json"
CDN_BASE = "https://cdn.openclawcn.net/update/artifacts"

# 项目根目录（脚本在 scripts/ 下）
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_BASE = PROJECT_ROOT / "src-tauri" / "target" / "release" / "bundle"


def get_password():
    """优先读环境变量，否则交互式输入（只输一次）。"""
    pw = os.environ.get("DEPLOY_SSH_PASSWORD")
    if pw:
        print(f"  使用环境变量 DEPLOY_SSH_PASSWORD 中的密码")
        return pw
    return getpass.getpass(f"SSH password for {USER}@{HOST}: ")


def collect_artifacts():
    """扫描 bundle 目录，收集各平台产物。返回 (platforms_dict, extra_uploads)。"""
    platforms = {}
    extra_uploads = []

    # Windows NSIS
    nsis_dir = BUNDLE_BASE / "nsis"
    if nsis_dir.is_dir():
        for f in nsis_dir.iterdir():
            if f.name.endswith("-setup.exe") and not f.name.endswith(".sig"):
                sig_file = f.with_suffix(f.suffix + ".sig")
                if sig_file.is_file():
                    platforms["windows-x86_64"] = {
                        "file": f,
                        "sig": sig_file.read_text(encoding="utf-8").strip(),
                    }
                    print(f"  [OK] Windows NSIS: {f.name}")
                break

    # macOS
    macos_dir = BUNDLE_BASE / "macos"
    if macos_dir.is_dir():
        for f in macos_dir.iterdir():
            if f.name.endswith(".app.tar.gz") and not f.name.endswith(".sig"):
                sig_file = Path(str(f) + ".sig")
                if sig_file.is_file():
                    platforms["darwin-aarch64"] = {
                        "file": f,
                        "sig": sig_file.read_text(encoding="utf-8").strip(),
                    }
                    print(f"  [OK] macOS (aarch64): {f.name}")
                break
        # .dmg for website downloads
        for f in macos_dir.iterdir():
            if f.name.endswith(".dmg"):
                extra_uploads.append(f)
                print(f"  [OK] macOS DMG: {f.name}")
                break

    # Linux AppImage
    appimage_dir = BUNDLE_BASE / "appimage"
    if appimage_dir.is_dir():
        for f in appimage_dir.iterdir():
            if f.name.endswith(".AppImage") and not f.name.endswith(".sig"):
                sig_file = Path(str(f) + ".sig")
                if sig_file.is_file():
                    platforms["linux-x86_64"] = {
                        "file": f,
                        "sig": sig_file.read_text(encoding="utf-8").strip(),
                    }
                    print(f"  [OK] Linux AppImage: {f.name}")
                break

    return platforms, extra_uploads


def fetch_existing_json():
    """通过 HTTPS 获取服务器现有 latest.json，失败返回 None。"""
    try:
        req = Request(UPDATE_URL, headers={"User-Agent": "publish-update/1.0"})
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, json.JSONDecodeError, OSError) as e:
        print(f"  无法获取服务器 latest.json: {e}")
        return None


def build_latest_json(version, platforms):
    """生成 latest.json 内容，同版本时合并已有平台条目。"""
    pub_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    existing = fetch_existing_json()
    existing_platforms = {}
    if existing and existing.get("version") == version:
        existing_platforms = existing.get("platforms", {})
        print(f"  服务器上已有 v{version}，将合并平台条目")
    elif existing:
        print(f"  服务器上版本为 v{existing.get('version')}，将创建全新 latest.json")
    else:
        print(f"  将创建全新 latest.json")

    # 合并：已有条目为基础，本次构建覆盖
    merged = dict(existing_platforms)
    for platform_key, info in platforms.items():
        filename = info["file"].name
        merged[platform_key] = {
            "url": f"{CDN_BASE}/{filename}",
            "signature": info["sig"],
        }

    return {
        "version": version,
        "notes": f"OpenClaw v{version} 更新",
        "pub_date": pub_date,
        "platforms": merged,
    }


def ssh_exec(ssh, cmd):
    """执行远程命令并打印输出。"""
    print(f"  $ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(f"    {out.strip()}")
    if err.strip():
        print(f"    STDERR: {err.strip()}")
    if code != 0:
        raise RuntimeError(f"Command failed (exit {code}): {cmd}\n{err}")
    return out.strip()


def upload(sftp, local_path, remote_path):
    """上传单个文件，打印进度。"""
    size_mb = local_path.stat().st_size / (1024 * 1024)
    print(f"  >> {local_path.name} ({size_mb:.1f} MB) -> {remote_path}")
    sftp.put(str(local_path), remote_path)


def main():
    if len(sys.argv) < 2:
        print(f"用法: python {sys.argv[0]} <版本号>")
        print(f"示例: python {sys.argv[0]} 0.3.0")
        sys.exit(1)

    version = sys.argv[1]
    print(f"=== 发布 OpenClaw v{version} 更新到 {HOST} ===\n")

    # 1. 收集产物
    print("[1/4] 扫描构建产物...")
    platforms, extra_uploads = collect_artifacts()
    if not platforms:
        print("ERROR: 未找到任何构建产物。请先运行 cargo tauri build。")
        sys.exit(1)

    # 2. 生成 latest.json
    print("\n[2/4] 生成 latest.json...")
    latest = build_latest_json(version, platforms)
    latest_str = json.dumps(latest, indent=2, ensure_ascii=False)
    print(f"\n{latest_str}\n")

    # 3. 获取密码并连接
    print("[3/4] 连接服务器...")
    password = get_password()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=password, timeout=30, banner_timeout=60)
    except Exception as e:
        print(f"ERROR: SSH 连接失败: {e}")
        sys.exit(1)
    print("  已连接!\n")

    # 4. 上传
    print("[4/4] 上传文件...")
    ssh_exec(ssh, f"mkdir -p {REMOTE_DIR}/artifacts")

    sftp = ssh.open_sftp()
    try:
        # 上传安装包
        for platform_key, info in platforms.items():
            upload(sftp, info["file"], f"{REMOTE_DIR}/artifacts/{info['file'].name}")

        # 上传额外文件（如 .dmg）
        for f in extra_uploads:
            upload(sftp, f, f"{REMOTE_DIR}/artifacts/{f.name}")

        # 上传 latest.json
        print(f"  >> latest.json -> {REMOTE_DIR}/latest.json")
        with sftp.open(f"{REMOTE_DIR}/latest.json", "w") as remote_f:
            remote_f.write(latest_str)
    finally:
        sftp.close()

    ssh.close()

    print(f"\n=== 发布完成! ===")
    print(f"  更新端点: {UPDATE_URL}")
    print(f"  安装包CDN: {CDN_BASE}/")
    print(f"\n  别忘了更新官网下载链接!")
    print(f"  1. 修改 openclawcn_web/src/app/page.tsx 中的版本号和文件名")
    print(f"  2. cd openclawcn_web && npm run build")
    print(f"  3. python deploy.py upload")


if __name__ == "__main__":
    main()
