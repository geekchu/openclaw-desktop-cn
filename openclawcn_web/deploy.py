#!/usr/bin/env python3
"""Deploy openclawcn_web static export to production server via SSH/SFTP."""
import paramiko
import os
import sys

HOST = "47.57.241.17"
USER = "root"
PASSWORD = os.environ.get("DEPLOY_SSH_PASSWORD", "Wqx505@550719")
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
