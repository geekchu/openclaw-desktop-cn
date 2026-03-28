#!/usr/bin/env python3
"""Deploy openclawcn_web static export to production server via SSH/SFTP."""
import getpass
import paramiko
import os
import sys

HOST = "openclawcn.net"  # 或 47.57.241.17（备用）
USER = "root"
PASSWORD = os.environ.get("DEPLOY_SSH_PASSWORD") or getpass.getpass(f"SSH password for {USER}@{HOST}: ")
REMOTE_DIR = "/var/www/openclawcn_web"
LOCAL_DIR = os.path.dirname(os.path.abspath(__file__))

def ssh_exec(ssh, cmd, check=True):
    print(f"  $ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(f"    {out.strip()}")
    if err.strip():
        print(f"    STDERR: {err.strip()}")
    if check and code != 0:
        raise RuntimeError(f"Command failed (exit {code}): {cmd}\n{err}")
    return out.strip(), err.strip(), code

def sftp_upload_dir(sftp, local_path, remote_path, skip_dirs=None, skip_files=None):
    """Recursively upload a directory."""
    if skip_dirs is None:
        skip_dirs = set()
    if skip_files is None:
        skip_files = {"lock"}

    try:
        sftp.stat(remote_path)
    except FileNotFoundError:
        sftp.mkdir(remote_path)

    for item in os.listdir(local_path):
        if item in skip_dirs or item in skip_files:
            continue
        local_item = os.path.join(local_path, item)
        remote_item = f"{remote_path}/{item}"

        if os.path.isfile(local_item):
            size = os.path.getsize(local_item)
            if size > 50 * 1024 * 1024:  # Skip files > 50MB
                print(f"    Skipping large file: {item} ({size // 1024 // 1024}MB)")
                continue
            try:
                sftp.put(local_item, remote_item)
            except PermissionError:
                print(f"    Skipping (permission denied): {local_item}")
                continue
        elif os.path.isdir(local_item):
            sftp_upload_dir(sftp, local_item, remote_item, skip_dirs, skip_files)

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "upload"

    print(f"Connecting to {HOST}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30, banner_timeout=60)
    print("Connected!")

    if action == "upload":
        # Static export: upload out/ directory contents
        out_dir = os.path.join(LOCAL_DIR, "out")
        if not os.path.isdir(out_dir):
            print("ERROR: out/ directory not found. Run 'npm run build' first.")
            sys.exit(1)

        # Clean and recreate remote directory
        ssh_exec(ssh, f"rm -rf {REMOTE_DIR} && mkdir -p {REMOTE_DIR}")

        sftp = ssh.open_sftp()
        print("Uploading static files from out/...")
        sftp_upload_dir(sftp, out_dir, REMOTE_DIR)
        sftp.close()
        print("Upload complete!")

        # Stop PM2 process if running (no longer needed for static site)
        ssh_exec(ssh, "pm2 delete openclawcn-web 2>/dev/null || true", check=False)

    elif action == "update-links":
        # Update only download links in the live index.html without redeploying the whole site.
        # Usage: python deploy.py update-links --platform windows --version 0.3.0
        #        python deploy.py update-links --platform macos --version 0.3.0
        #        python deploy.py update-links --platform linux --version 0.3.0
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("_action")
        parser.add_argument("--platform", required=True, choices=["windows", "macos", "linux"])
        parser.add_argument("--version", required=True)
        args = parser.parse_args()
        ver = args.version
        html_path = f"{REMOTE_DIR}/index.html"
        # LC_ALL=C.UTF-8 ensures sed handles multibyte (Chinese) characters correctly
        def sed(pattern, replacement):
            ssh_exec(ssh, f"LC_ALL=C.UTF-8 sed -i 's|{pattern}|{replacement}|g' {html_path}")

        def verify(expected):
            out, _, code = ssh_exec(ssh, f"grep -c '{expected}' {html_path}", check=False)
            # code=1 means no match, code=2 means file not found; both are failures
            if code != 0 or out.strip() == "0":
                raise RuntimeError(f"update-links verification failed: '{expected}' not found in {html_path}")

        if args.platform == "windows":
            sed(r'OpenClaw桌面版_[0-9.]*_x64-setup\.exe', f'OpenClaw桌面版_{ver}_x64-setup.exe')
            sed(r'下载 Windows 版 (v[0-9.]*)', f'下载 Windows 版 (v{ver})')
            verify(f'OpenClaw桌面版_{ver}_x64-setup.exe')
            verify(f'下载 Windows 版 (v{ver})')
            print(f"Updated Windows download links to v{ver}")
        elif args.platform == "macos":
            sed(r'OpenClaw桌面版_[0-9.]*_aarch64\.dmg', f'OpenClaw桌面版_{ver}_aarch64.dmg')
            sed(r'OpenClaw桌面版_[0-9.]*_x64\.dmg', f'OpenClaw桌面版_{ver}_x64.dmg')
            sed(r'下载 macOS 版 - Apple Silicon (v[0-9.]*)', f'下载 macOS 版 - Apple Silicon (v{ver})')
            sed(r'下载 macOS 版 - Intel (v[0-9.]*)', f'下载 macOS 版 - Intel (v{ver})')
            verify(f'OpenClaw桌面版_{ver}_aarch64.dmg')
            verify(f'OpenClaw桌面版_{ver}_x64.dmg')
            verify(f'下载 macOS 版 - Apple Silicon (v{ver})')
            verify(f'下载 macOS 版 - Intel (v{ver})')
            print(f"Updated macOS download links to v{ver}")
        elif args.platform == "linux":
            sed(r'OpenClaw桌面版_[0-9.]*_amd64\.AppImage', f'OpenClaw桌面版_{ver}_amd64.AppImage')
            sed(r'下载 Linux 版 (v[0-9.]*)', f'下载 Linux 版 (v{ver})')
            verify(f'OpenClaw桌面版_{ver}_amd64.AppImage')
            verify(f'下载 Linux 版 (v{ver})')
            print(f"Updated Linux download links to v{ver}")

    elif action == "nginx":
        # Static site: serve directly from Nginx, no proxy needed
        nginx_config = """server {
    listen 80;
    server_name openclawcn.net www.openclawcn.net;

    root /var/www/openclawcn_web;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
    gzip_min_length 256;

    # Static assets: long cache
    location /_next/static/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /logos/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location /images/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # HTML pages: no cache (always fresh)
    location / {
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri.html $uri/index.html =404;
    }

    # Update endpoint (keep existing)
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

    location = /update/latest-macos.json {
        alias /var/www/openclaw-update/latest-macos.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache" always;
        default_type application/json;
    }

    location = /update/latest-windows.json {
        alias /var/www/openclaw-update/latest-windows.json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "no-cache" always;
        default_type application/json;
    }
}
"""
        print("Writing nginx config for static site...")
        sftp = ssh.open_sftp()
        config_path = "/etc/nginx/sites-available/openclawcn.net"
        with sftp.open(config_path, 'w') as f:
            f.write(nginx_config)
        sftp.close()

        # Enable site
        ssh_exec(ssh, "ln -sf /etc/nginx/sites-available/openclawcn.net /etc/nginx/sites-enabled/openclawcn.net")

        # Test and reload
        ssh_exec(ssh, "nginx -t")
        ssh_exec(ssh, "systemctl reload nginx")
        print("Nginx configured for static serving!")

    elif action == "certbot":
        print("Running certbot for HTTPS...")
        ssh_exec(ssh, "certbot --nginx -d openclawcn.net -d www.openclawcn.net --non-interactive --agree-tos --email admin@openclawcn.net")
        print("HTTPS configured!")

    elif action == "verify":
        print("Verifying deployment...")
        ssh_exec(ssh, "curl -s -o /dev/null -w 'HTTPS Status: %{http_code}\\n' https://openclawcn.net/", check=False)
        ssh_exec(ssh, "curl -s -o /dev/null -w 'HTTP->HTTPS redirect: %{http_code}\\n' -L http://openclawcn.net/", check=False)
        # Check existing services
        print("Checking existing services...")
        ssh_exec(ssh, "curl -s -o /dev/null -w 'api (3000): %{http_code}\\n' http://127.0.0.1:3000/", check=False)
        ssh_exec(ssh, "curl -s -o /dev/null -w 'wechat (3001): %{http_code}\\n' http://127.0.0.1:3001/", check=False)

    elif action == "cmd":
        # Run arbitrary command
        cmd = " ".join(sys.argv[2:])
        ssh_exec(ssh, cmd, check=False)

    ssh.close()

if __name__ == "__main__":
    main()
