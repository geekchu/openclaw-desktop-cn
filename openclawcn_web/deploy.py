#!/usr/bin/env python3
"""Deploy openclawcn_web to production server via SSH/SFTP."""
import paramiko
import os
import sys
import stat

HOST = "8.223.32.138"
USER = "root"
PASSWORD = os.environ.get("DEPLOY_SSH_PASSWORD", "")
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
    ssh.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    print("Connected!")

    if action == "upload":
        # Create remote directory
        ssh_exec(ssh, f"mkdir -p {REMOTE_DIR}")

        sftp = ssh.open_sftp()

        # Upload root config files
        root_files = [
            "package.json",
            "package-lock.json",
            "next.config.js",
            "postcss.config.js",
            "tailwind.config.js",
            "tsconfig.json",
        ]
        print("Uploading config files...")
        for f in root_files:
            local_f = os.path.join(LOCAL_DIR, f)
            if os.path.exists(local_f):
                print(f"  -> {f}")
                sftp.put(local_f, f"{REMOTE_DIR}/{f}")

        # Upload public/ directory
        public_dir = os.path.join(LOCAL_DIR, "public")
        if os.path.isdir(public_dir):
            print("Uploading public/...")
            sftp_upload_dir(sftp, public_dir, f"{REMOTE_DIR}/public")

        # Upload .next/ directory (build output)
        next_dir = os.path.join(LOCAL_DIR, ".next")
        if os.path.isdir(next_dir):
            print("Uploading .next/ (this may take a while)...")
            sftp_upload_dir(sftp, next_dir, f"{REMOTE_DIR}/.next", skip_dirs={"cache", "dev"})

        # Upload src/ directory (needed for some Next.js features)
        src_dir = os.path.join(LOCAL_DIR, "src")
        if os.path.isdir(src_dir):
            print("Uploading src/...")
            sftp_upload_dir(sftp, src_dir, f"{REMOTE_DIR}/src")

        sftp.close()
        print("Upload complete!")

        # Install production dependencies on server
        print("Installing production dependencies on server...")
        ssh_exec(ssh, f"cd {REMOTE_DIR} && npm install --production", check=True)
        print("Dependencies installed!")

    elif action == "pm2":
        # Install pm2 if not present
        _, _, code = ssh_exec(ssh, "pm2 --version", check=False)
        if code != 0:
            print("Installing pm2...")
            ssh_exec(ssh, "npm install -g pm2")

        # Stop existing process if any
        ssh_exec(ssh, "pm2 delete openclawcn-web 2>/dev/null || true", check=False)

        # Start with pm2
        print("Starting Next.js with pm2 on port 3002...")
        ssh_exec(ssh, f"cd {REMOTE_DIR} && PORT=3002 pm2 start npm --name openclawcn-web -- start")

        # Save and setup startup
        ssh_exec(ssh, "pm2 save")
        ssh_exec(ssh, "pm2 startup systemd -u root --hp /root 2>/dev/null || true", check=False)

        # Verify it's running
        ssh_exec(ssh, "pm2 list")
        ssh_exec(ssh, "sleep 3 && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/", check=False)

    elif action == "nginx":
        nginx_config = """server {
    listen 80;
    server_name openclawcn.net www.openclawcn.net;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
"""
        print("Writing nginx config...")
        # Write config file
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
        print("Nginx configured and reloaded!")

    elif action == "certbot":
        print("Running certbot for HTTPS...")
        ssh_exec(ssh, "certbot --nginx -d openclawcn.net -d www.openclawcn.net --non-interactive --agree-tos --email admin@openclawcn.net")
        print("HTTPS configured!")

    elif action == "verify":
        print("Verifying deployment...")
        ssh_exec(ssh, "pm2 list")
        ssh_exec(ssh, "curl -s -o /dev/null -w 'HTTP Status: %{http_code}\\n' http://127.0.0.1:3002/", check=False)
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
