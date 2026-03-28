#!/usr/bin/env python3
"""
OpenClaw 更新发布脚本 (Python + paramiko)

替代 publish-update.sh，解决 Windows 上 scp 多次输密码、jq 依赖、中文文件名编码等问题。

用法:
  python scripts/publish-update.py <版本号> --platform macos
  python scripts/publish-update.py <版本号> --platform windows
  python scripts/publish-update.py <版本号> --platform linux
  python scripts/publish-update.py <版本号> --platform all

示例:
  python scripts/publish-update.py 0.3.0 --platform macos
  python scripts/publish-update.py 0.3.0 --platform windows
  python scripts/publish-update.py 0.3.0 --platform linux
  python scripts/publish-update.py 0.3.0 --platform all  # 旧版 Windows 客户端兼容 latest.json

前提条件:
1. 已完成 cargo tauri build（且设置了 TAURI_SIGNING_PRIVATE_KEY 环境变量）
2. 服务器已通过 setup-update-server.sh + deploy-update-nginx.sh 初始化
3. pip install paramiko（如未安装）
"""
import argparse
import base64
import getpass
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

try:
    import paramiko
except ImportError:
    print("ERROR: paramiko 未安装。请运行: pip install paramiko")
    sys.exit(1)

# ── 常量 ──
HOST = "47.57.241.17"
USER = "root"
REMOTE_DIR = "/var/www/openclaw-update"
CDN_BASE = "https://cdn.openclawcn.net/update/artifacts"
UPDATE_METADATA = {
    "all": {
        "path": "latest.json",
        "url": "https://openclawcn.net/update/latest.json",
        # latest.json 仅保留给旧版 Windows 客户端，始终只写入 Windows 条目
        "platforms": {"windows-x86_64"},
    },
    "macos": {
        "path": "latest-macos.json",
        "url": "https://openclawcn.net/update/latest-macos.json",
        "platforms": {"darwin-aarch64", "darwin-x86_64"},
    },
    "windows": {
        "path": "latest-windows.json",
        "url": "https://openclawcn.net/update/latest-windows.json",
        "platforms": {"windows-x86_64"},
    },
    "linux": {
        "path": "latest-linux.json",
        "url": "https://openclawcn.net/update/latest-linux.json",
        "platforms": {"linux-x86_64"},
    },
}

# 项目根目录（脚本在 scripts/ 下）
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_BASE = PROJECT_ROOT / "src-tauri" / "target" / "release" / "bundle"
TAURI_CONF = PROJECT_ROOT / "src-tauri" / "tauri.conf.json"


def parse_args():
    parser = argparse.ArgumentParser(description="发布 OpenClaw Tauri updater 元数据")
    parser.add_argument("version", help="要发布的安装包版本号")
    parser.add_argument(
        "--platform",
        choices=("all", "macos", "windows", "linux"),
        required=True,
        help="发布目标平台；all 表示额外写入旧版 Windows 客户端读取的 latest.json",
    )
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="跳过签名验证（不推荐，仅用于调试）",
    )
    return parser.parse_args()


def get_pubkey_from_config():
    """从 tauri.conf.json 读取 updater 公钥。"""
    if not TAURI_CONF.is_file():
        return None
    try:
        with open(TAURI_CONF, "r", encoding="utf-8") as f:
            conf = json.load(f)
        pubkey_b64 = conf.get("plugins", {}).get("updater", {}).get("pubkey")
        if pubkey_b64:
            # 解码 Base64 得到原始公钥内容
            return base64.b64decode(pubkey_b64).decode("utf-8").strip()
        return None
    except (json.JSONDecodeError, KeyError, UnicodeDecodeError, ValueError):
        # ValueError 包含 base64.binascii.Error
        return None


def verify_signature(artifact_path, sig_content, pubkey_content):
    """
    使用 minisign 验证签名。
    返回 (success: bool, message: str)
    """
    import tempfile
    import shutil

    # 检查 minisign 是否可用
    minisign_cmd = shutil.which("minisign")
    if not minisign_cmd:
        # 尝试 cargo tauri signer verify（Tauri CLI 内置）
        cargo_tauri = shutil.which("cargo-tauri") or shutil.which("tauri")
        if cargo_tauri:
            return (None, "minisign 未安装，跳过签名验证（建议安装 minisign 以启用验证）")
        return (None, "minisign 未安装，跳过签名验证")

    # 创建临时文件存放公钥和签名
    with tempfile.NamedTemporaryFile(mode="w", suffix=".pub", delete=False) as pk_file:
        pk_file.write(pubkey_content)
        pk_path = pk_file.name

    with tempfile.NamedTemporaryFile(mode="w", suffix=".sig", delete=False) as sig_file:
        sig_file.write(sig_content)
        sig_path = sig_file.name

    try:
        # minisign -Vm <file> -p <pubkey> -x <signature>
        result = subprocess.run(
            [minisign_cmd, "-Vm", str(artifact_path), "-p", pk_path, "-x", sig_path],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            return (True, "签名验证通过")
        else:
            return (False, f"签名验证失败: {result.stderr.strip() or result.stdout.strip()}")
    except subprocess.TimeoutExpired:
        return (False, "签名验证超时")
    except Exception as e:
        return (None, f"签名验证出错: {e}")
    finally:
        # 清理临时文件
        try:
            os.unlink(pk_path)
            os.unlink(sig_path)
        except OSError:
            pass


def get_password():
    """优先读环境变量，否则交互式输入（只输一次）。"""
    pw = os.environ.get("DEPLOY_SSH_PASSWORD")
    if pw:
        print(f"  使用环境变量 DEPLOY_SSH_PASSWORD 中的密码")
        return pw
    return getpass.getpass(f"SSH password for {USER}@{HOST}: ")


def collect_artifacts(version, release_platform):
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
                remote_name = f.name.replace(".app.tar.gz", f"_{version}_{arch_suffix}.app.tar.gz")
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

    allowed_platforms = UPDATE_METADATA[release_platform]["platforms"]
    if allowed_platforms is not None:
        platforms = {
            platform_key: info
            for platform_key, info in platforms.items()
            if platform_key in allowed_platforms
        }
        if release_platform != "macos":
            extra_uploads = []

    return platforms, extra_uploads


def fetch_existing_json(update_url):
    """通过 HTTPS 获取服务器现有 updater 元数据，失败返回 None。"""
    try:
        req = Request(update_url, headers={"User-Agent": "publish-update/1.0"})
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 404:
            print("  服务器上还没有目标平台 updater 元数据，将创建全新文件")
            return None
        raise RuntimeError(f"无法获取服务器 updater 元数据 (HTTP {e.code}): {e.reason}") from e
    except (URLError, UnicodeDecodeError, json.JSONDecodeError, OSError) as e:
        raise RuntimeError(f"无法获取服务器 updater 元数据: {e}") from e


def build_latest_json(version, platforms, update_url, allowed_platforms):
    """生成 updater 元数据内容，同版本时仅合并目标元数据允许的平台条目。"""
    pub_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    existing = fetch_existing_json(update_url)
    existing_platforms = {}
    if existing and existing.get("version") == version:
        existing_platforms = existing.get("platforms", {})
        if allowed_platforms is not None:
            existing_platforms = {
                platform_key: info
                for platform_key, info in existing_platforms.items()
                if platform_key in allowed_platforms
            }
        print(f"  服务器上已有 v{version}，将合并平台条目")
    elif existing:
        print(f"  服务器上版本为 v{existing.get('version')}，将创建全新 updater 元数据")
    else:
        print(f"  将创建全新 updater 元数据")

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
    args = parse_args()
    version = args.version
    release_platform = args.platform
    skip_verify = args.skip_verify
    update_meta = UPDATE_METADATA[release_platform]
    update_url = update_meta["url"]
    update_filename = update_meta["path"]
    allowed_platforms = update_meta["platforms"]

    print(f"=== 发布 OpenClaw v{version} 更新到 {HOST} ===")
    print(f"=== 目标平台: {release_platform} ===\n")

    # 1. 收集产物
    print("[1/5] 扫描构建产物...")
    platforms, extra_uploads = collect_artifacts(version, release_platform)
    if not platforms:
        print("ERROR: 未找到目标平台的构建产物。请先运行对应平台的 cargo tauri build。")
        sys.exit(1)

    # 2. 验证签名（确保公钥与签名匹配）
    print("\n[2/5] 验证签名...")
    if skip_verify:
        print("  ⚠️  跳过签名验证（--skip-verify）")
    else:
        pubkey = get_pubkey_from_config()
        if not pubkey:
            print("  ⚠️  无法从 tauri.conf.json 读取公钥，跳过签名验证")
            print("     请确保 plugins.updater.pubkey 已正确配置")
        else:
            all_verified = True
            for platform_key, info in platforms.items():
                artifact_path = info["file"]
                sig_content = info["sig"]
                success, message = verify_signature(artifact_path, sig_content, pubkey)
                if success is True:
                    print(f"  [OK] {platform_key}: {message}")
                elif success is False:
                    print(f"  [FAIL] {platform_key}: {message}")
                    all_verified = False
                else:
                    # success is None - 无法验证（minisign 未安装等）
                    print(f"  [SKIP] {platform_key}: {message}")

            if not all_verified:
                print("\nERROR: 签名验证失败！")
                print("可能原因：")
                print("  1. 构建时使用的私钥与 tauri.conf.json 中的公钥不匹配")
                print("  2. 签名文件损坏或被修改")
                print("  3. 安装包文件在签名后被修改")
                print("\n请检查密钥配置后重新构建，或使用 --skip-verify 跳过验证（不推荐）")
                sys.exit(1)

    # 3. 生成 updater 元数据
    print("\n[3/5] 生成 updater 元数据...")
    try:
        latest = build_latest_json(version, platforms, update_url, allowed_platforms)
    except RuntimeError as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    latest_str = json.dumps(latest, indent=2, ensure_ascii=False)
    print(f"\n{latest_str}\n")

    # 4. 获取密码并连接
    print("[4/5] 连接服务器...")
    password = get_password()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=password, timeout=30, banner_timeout=60)
    except Exception as e:
        print(f"ERROR: SSH 连接失败: {e}")
        sys.exit(1)
    print("  已连接!\n")

    # 5. 上传
    print("[5/5] 上传文件...")
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

        # 上传 updater 元数据
        print(f"  >> {update_filename} -> {REMOTE_DIR}/{update_filename}")
        with sftp.open(f"{REMOTE_DIR}/{update_filename}", "w") as remote_f:
            remote_f.write(latest_str)
    finally:
        sftp.close()

    ssh.close()

    print(f"\n=== 发布完成! ===")
    print(f"  更新端点: {update_url}")
    print(f"  安装包CDN: {CDN_BASE}/")
    print(f"\n  别忘了更新官网下载链接!")
    print(f"  1. 修改 openclawcn_web/src/app/page.tsx 中的版本号和文件名")
    print(f"  2. cd openclawcn_web && npm run build")
    print(f"  3. python deploy.py upload")


if __name__ == "__main__":
    main()
