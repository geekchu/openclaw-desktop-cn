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
import re
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


def collect_artifacts(version):
    """扫描 bundle 目录，收集各平台产物。返回 (platforms_dict, extra_uploads)。"""
    platforms = {}
    extra_uploads = []

    version_pattern = re.compile(rf"(^|[_-]){re.escape(version)}([_.-]|$)")

    def matches_requested_version(file_path):
        return bool(version_pattern.search(file_path.name))

    def pick_signed_artifact(directory, predicate, sig_path_for):
        signed = []
        for file_path in directory.iterdir():
            if not predicate(file_path):
                continue
            sig_file = sig_path_for(file_path)
            if sig_file.is_file():
                signed.append((file_path, sig_file))
        if not signed:
            return None, None
        matching_version = [item for item in signed if matches_requested_version(item[0])]
        if matching_version:
            signed = matching_version
        signed.sort(key=lambda item: item[0].stat().st_mtime_ns, reverse=True)
        return signed[0]

    def pick_latest_artifact(directory, predicate):
        matches = [file_path for file_path in directory.iterdir() if predicate(file_path)]
        if not matches:
            return None
        matching_version = [file_path for file_path in matches if matches_requested_version(file_path)]
        if matching_version:
            matches = matching_version
        matches.sort(key=lambda file_path: file_path.stat().st_mtime_ns, reverse=True)
        return matches[0]

    # Windows NSIS
    nsis_dir = BUNDLE_BASE / "nsis"
    if nsis_dir.is_dir():
        f, sig_file = pick_signed_artifact(
            nsis_dir,
            lambda file_path: file_path.name.endswith("-setup.exe") and not file_path.name.endswith(".sig"),
            lambda file_path: file_path.with_suffix(file_path.suffix + ".sig"),
        )
        if f and sig_file:
            platforms["windows-x86_64"] = {
                "file": f,
                "sig": sig_file.read_text(encoding="utf-8").strip(),
            }
            print(f"  [OK] Windows NSIS: {f.name}")

    # macOS - 检查多个可能的目录（原生构建 + 跨架构构建）
    # 原生构建: target/release/bundle/macos/
    # 跨架构构建: target/<arch>/release/bundle/macos/
    macos_bundle_dirs = [
        ("darwin-aarch64", BUNDLE_BASE / "macos"),  # 原生 ARM 构建
        ("darwin-aarch64", PROJECT_ROOT / "src-tauri" / "target" / "aarch64-apple-darwin" / "release" / "bundle" / "macos"),
        ("darwin-x86_64", PROJECT_ROOT / "src-tauri" / "target" / "x86_64-apple-darwin" / "release" / "bundle" / "macos"),
    ]

    # DMG 目录（用于官网下载）
    macos_dmg_dirs = [
        BUNDLE_BASE / "dmg",
        PROJECT_ROOT / "src-tauri" / "target" / "aarch64-apple-darwin" / "release" / "bundle" / "dmg",
        PROJECT_ROOT / "src-tauri" / "target" / "x86_64-apple-darwin" / "release" / "bundle" / "dmg",
    ]

    for platform_key, macos_dir in macos_bundle_dirs:
        if platform_key in platforms:
            continue  # 已找到该架构的产物
        if macos_dir.is_dir():
            f, sig_file = pick_signed_artifact(
                macos_dir,
                lambda file_path: file_path.name.endswith(".app.tar.gz") and not file_path.name.endswith(".sig"),
                lambda file_path: Path(str(file_path) + ".sig"),
            )
            if f and sig_file:
                # 为 macOS 文件添加架构后缀，避免不同架构文件互相覆盖
                arch_suffix = "aarch64" if "aarch64" in platform_key else "x64"
                remote_name = f.name.replace(".app.tar.gz", f"_{arch_suffix}.app.tar.gz")
                platforms[platform_key] = {
                    "file": f,
                    "sig": sig_file.read_text(encoding="utf-8").strip(),
                    "remote_name": remote_name,  # 上传到服务器时使用的文件名
                }
                print(f"  [OK] macOS ({platform_key}): {f.name} -> {remote_name}")

    # 收集所有 DMG 文件用于官网下载
    for dmg_dir in macos_dmg_dirs:
        if dmg_dir.is_dir():
            dmg_file = pick_latest_artifact(dmg_dir, lambda file_path: file_path.name.endswith(".dmg"))
            if dmg_file and dmg_file not in extra_uploads:
                extra_uploads.append(dmg_file)
                print(f"  [OK] macOS DMG: {dmg_file.name}")

    # Linux AppImage
    appimage_dir = BUNDLE_BASE / "appimage"
    if appimage_dir.is_dir():
        f, sig_file = pick_signed_artifact(
            appimage_dir,
            lambda file_path: file_path.name.endswith(".AppImage") and not file_path.name.endswith(".sig"),
            lambda file_path: Path(str(file_path) + ".sig"),
        )
        if f and sig_file:
            platforms["linux-x86_64"] = {
                "file": f,
                "sig": sig_file.read_text(encoding="utf-8").strip(),
            }
            print(f"  [OK] Linux AppImage: {f.name}")

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
        # 使用 remote_name（如果有）作为 URL 文件名，否则使用原文件名
        filename = info.get("remote_name", info["file"].name)
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
    platforms, extra_uploads = collect_artifacts(version)
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
            # 使用 remote_name（如果有）作为远程文件名
            remote_name = info.get("remote_name", info["file"].name)
            upload(sftp, info["file"], f"{REMOTE_DIR}/artifacts/{remote_name}")

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
