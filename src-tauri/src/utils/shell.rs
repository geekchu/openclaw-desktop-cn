use std::process::{Command, Output};
use std::io;
use std::path::Path;
use std::collections::HashMap;
use crate::utils::platform;
use crate::utils::file;
use log::{info, debug, warn};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows CREATE_NO_WINDOW 标志，用于隐藏控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 获取扩展的 PATH 环境变量
/// GUI 应用启动时可能没有继承用户 shell 的 PATH，需要手动添加常见路径
pub fn get_extended_path() -> String {
    let mut paths = Vec::new();

    // Windows 上只使用当前 PATH，不添加 Unix 路径
    if platform::is_windows() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        return current_path;
    }

    // Unix: 添加常见的可执行文件路径
    paths.push("/opt/homebrew/bin".to_string());  // Homebrew on Apple Silicon
    paths.push("/usr/local/bin".to_string());      // Homebrew on Intel / 常规安装
    paths.push("/usr/bin".to_string());
    paths.push("/bin".to_string());

    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();

        // nvm 路径（尝试获取当前版本）
        let nvm_default = format!("{}/.nvm/alias/default", home_str);
        if let Ok(version) = std::fs::read_to_string(&nvm_default) {
            let version = version.trim();
            if !version.is_empty() {
                paths.insert(0, format!("{}/.nvm/versions/node/v{}/bin", home_str, version));
            }
        }
        // 也添加常见 nvm 版本路径
        for version in ["v22.22.0", "v22.12.0", "v22.11.0", "v22.0.0", "v23.0.0"] {
            let nvm_bin = format!("{}/.nvm/versions/node/{}/bin", home_str, version);
            if std::path::Path::new(&nvm_bin).exists() {
                paths.insert(0, nvm_bin);
                break; // 只添加第一个存在的
            }
        }

        // fnm
        paths.push(format!("{}/.fnm/aliases/default/bin", home_str));

        // volta
        paths.push(format!("{}/.volta/bin", home_str));

        // asdf
        paths.push(format!("{}/.asdf/shims", home_str));

        // mise
        paths.push(format!("{}/.local/share/mise/shims", home_str));
    }

    // 获取当前 PATH 并合并
    let current_path = std::env::var("PATH").unwrap_or_default();
    if !current_path.is_empty() {
        paths.push(current_path);
    }

    paths.join(":")
}

/// 执行 Shell 命令（带扩展 PATH）
pub fn run_command(cmd: &str, args: &[&str]) -> io::Result<Output> {
    let mut command = Command::new(cmd);
    command.args(args);
    
    // 在非 Windows 系统上使用扩展的 PATH
    #[cfg(not(windows))]
    {
        let extended_path = get_extended_path();
        command.env("PATH", extended_path);
    }
    
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    
    command.output()
}

/// 执行 Shell 命令并获取输出字符串
pub fn run_command_output(cmd: &str, args: &[&str]) -> Result<String, String> {
    match run_command(cmd, args) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 Bash 命令（带扩展 PATH）
pub fn run_bash(script: &str) -> io::Result<Output> {
    let mut command = Command::new("bash");
    command.arg("-c").arg(script);
    
    // 在非 Windows 系统上使用扩展的 PATH
    #[cfg(not(windows))]
    {
        let extended_path = get_extended_path();
        command.env("PATH", extended_path);
    }
    
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    
    command.output()
}

/// 执行 Bash 命令并获取输出
pub fn run_bash_output(script: &str) -> Result<String, String> {
    match run_bash(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    Err(format!("Command failed with exit code: {:?}", output.status.code()))
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 cmd.exe 命令（Windows）- 避免 PowerShell 执行策略问题
pub fn run_cmd(script: &str) -> io::Result<Output> {
    let mut cmd = Command::new("cmd");
    cmd.args(["/c", script]);
    
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    
    cmd.output()
}

/// 执行 cmd.exe 命令并获取输出（Windows）
pub fn run_cmd_output(script: &str) -> Result<String, String> {
    match run_cmd(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if stdout.is_empty() {
                        Err(format!("Command failed with exit code: {:?}", output.status.code()))
                    } else {
                        Err(stdout)
                    }
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 PowerShell 命令（Windows）- 仅在需要 PowerShell 特定功能时使用
/// 注意：某些 Windows 系统的 PowerShell 执行策略可能禁止运行脚本
pub fn run_powershell(script: &str) -> io::Result<Output> {
    let mut cmd = Command::new("powershell");
    // 使用 -ExecutionPolicy Bypass 绕过执行策略限制
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    
    cmd.output()
}

/// 执行 PowerShell 命令并获取输出（Windows）
pub fn run_powershell_output(script: &str) -> Result<String, String> {
    match run_powershell(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if stdout.is_empty() {
                        Err(format!("Command failed with exit code: {:?}", output.status.code()))
                    } else {
                        Err(stdout)
                    }
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 跨平台执行脚本命令
/// Windows 上使用 cmd.exe（避免 PowerShell 执行策略问题）
pub fn run_script_output(script: &str) -> Result<String, String> {
    if platform::is_windows() {
        run_cmd_output(script)
    } else {
        run_bash_output(script)
    }
}

/// 后台执行命令（不等待结果）
pub fn spawn_background(script: &str) -> io::Result<()> {
    if platform::is_windows() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", script]);
        
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        
        cmd.spawn()?;
    } else {
        Command::new("bash")
            .arg("-c")
            .arg(script)
            .spawn()?;
    }
    Ok(())
}

/// 获取 Node.js 可执行文件路径
/// 检测多个可能的安装路径，因为 GUI 应用不继承用户 shell 的 PATH
pub fn get_node_path() -> Option<String> {
    if platform::is_windows() {
        // 先尝试 where node
        if let Ok(output) = run_cmd_output("where node") {
            let path = output.lines().next().unwrap_or("").trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                info!("[Shell] 通过 where 找到 Node.js: {}", path);
                return Some(path);
            }
        }
        // 检查常见安装路径
        let possible_paths = get_windows_node_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                info!("[Shell] 在 {} 找到 Node.js", path);
                return Some(path);
            }
        }
    } else {
        // Unix: 先尝试 which node
        if let Ok(output) = run_command_output("which", &["node"]) {
            let path = output.trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                info!("[Shell] 通过 which 找到 Node.js: {}", path);
                return Some(path);
            }
        }
        // 检查常见安装路径
        let possible_paths = get_unix_node_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                info!("[Shell] 在 {} 找到 Node.js", path);
                return Some(path);
            }
        }
        // 最后尝试通过用户 shell 查找
        if let Ok(path) = run_bash_output("source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null; which node 2>/dev/null") {
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                info!("[Shell] 通过用户 shell 找到 Node.js: {}", path);
                return Some(path);
            }
        }
    }

    None
}

/// 获取 Windows 系统上可能的 Node.js 路径
fn get_windows_node_paths() -> Vec<String> {
    let mut paths = Vec::new();

    // 标准安装路径
    paths.push("C:\\Program Files\\nodejs\\node.exe".to_string());
    paths.push("C:\\Program Files (x86)\\nodejs\\node.exe".to_string());

    // nvm for Windows (nvm4w)
    paths.push("C:\\nvm4w\\nodejs\\node.exe".to_string());

    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();
        // nvm for Windows 用户安装
        paths.push(format!("{}\\AppData\\Roaming\\nvm\\current\\node.exe", home_str));
        // fnm
        paths.push(format!("{}\\AppData\\Roaming\\fnm\\aliases\\default\\node.exe", home_str));
        paths.push(format!("{}\\AppData\\Local\\fnm\\aliases\\default\\node.exe", home_str));
        paths.push(format!("{}\\.fnm\\aliases\\default\\node.exe", home_str));
        // volta
        paths.push(format!("{}\\AppData\\Local\\Volta\\bin\\node.exe", home_str));
        // scoop
        paths.push(format!("{}\\scoop\\apps\\nodejs\\current\\node.exe", home_str));
        paths.push(format!("{}\\scoop\\apps\\nodejs-lts\\current\\node.exe", home_str));
    }

    // nvm-windows 符号链接
    if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
        paths.insert(0, format!("{}\\node.exe", nvm_symlink));
    }

    // nvm-windows NVM_HOME
    if let Ok(nvm_home) = std::env::var("NVM_HOME") {
        let settings_path = format!("{}\\settings.txt", nvm_home);
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            for line in content.lines() {
                if line.starts_with("current:") {
                    if let Some(version) = line.strip_prefix("current:") {
                        let version = version.trim();
                        if !version.is_empty() {
                            paths.insert(0, format!("{}\\v{}\\node.exe", nvm_home, version));
                        }
                    }
                }
            }
        }
    }

    paths
}

/// 获取 Unix 系统上可能的 Node.js 路径
fn get_unix_node_paths() -> Vec<String> {
    let mut paths = Vec::new();

    // Homebrew (macOS)
    paths.push("/opt/homebrew/bin/node".to_string());
    paths.push("/usr/local/bin/node".to_string());
    paths.push("/usr/bin/node".to_string());

    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();

        // nvm 默认版本
        let nvm_default = format!("{}/.nvm/alias/default", home_str);
        if let Ok(version) = std::fs::read_to_string(&nvm_default) {
            let version = version.trim();
            if !version.is_empty() {
                paths.insert(0, format!("{}/.nvm/versions/node/v{}/bin/node", home_str, version));
            }
        }
        for version in ["v22.22.0", "v22.12.0", "v22.11.0", "v22.0.0", "v23.0.0"] {
            paths.push(format!("{}/.nvm/versions/node/{}/bin/node", home_str, version));
        }

        // fnm
        paths.push(format!("{}/.fnm/aliases/default/bin/node", home_str));
        // volta
        paths.push(format!("{}/.volta/bin/node", home_str));
        // asdf
        paths.push(format!("{}/.asdf/shims/node", home_str));
        // mise
        paths.push(format!("{}/.local/share/mise/shims/node", home_str));
    }

    paths
}

/// 获取 openclaw 可执行文件路径
/// 检测多个可能的安装路径，因为 GUI 应用不继承用户 shell 的 PATH
pub fn get_openclaw_path() -> Option<String> {
    // Windows: 检查常见的 npm 全局安装路径
    if platform::is_windows() {
        let possible_paths = get_windows_openclaw_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                info!("[Shell] 在 {} 找到 openclaw", path);
                return Some(path);
            }
        }
    } else {
        // Unix: 检查常见的 npm 全局安装路径
        let possible_paths = get_unix_openclaw_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                info!("[Shell] 在 {} 找到 openclaw", path);
                return Some(path);
            }
        }
    }
    
    // 回退：检查是否在 PATH 中
    if command_exists("openclaw") {
        return Some("openclaw".to_string());
    }
    
    // 最后尝试：通过用户 shell 查找
    if !platform::is_windows() {
        if let Ok(path) = run_bash_output("source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null; which openclaw 2>/dev/null") {
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                info!("[Shell] 通过用户 shell 找到 openclaw: {}", path);
                return Some(path);
            }
        }
    }
    
    None
}

/// 获取 Unix 系统上可能的 openclaw 安装路径
fn get_unix_openclaw_paths() -> Vec<String> {
    let mut paths = Vec::new();
    
    // npm 全局安装路径
    paths.push("/usr/local/bin/openclaw".to_string());
    paths.push("/opt/homebrew/bin/openclaw".to_string()); // Homebrew on Apple Silicon
    paths.push("/usr/bin/openclaw".to_string());
    
    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();
        
        // npm 全局安装到用户目录
        paths.push(format!("{}/.npm-global/bin/openclaw", home_str));
        
        // nvm 安装的 npm 全局包（需要找到正确的 node 版本目录）
        // 先检查常见版本
        for version in ["v22.0.0", "v22.1.0", "v22.2.0", "v22.11.0", "v22.12.0", "v23.0.0"] {
            paths.push(format!("{}/.nvm/versions/node/{}/bin/openclaw", home_str, version));
        }
        
        // 检查 nvm current（尝试读取 .nvmrc 或 default）
        let nvm_default = format!("{}/.nvm/alias/default", home_str);
        if let Ok(version) = std::fs::read_to_string(&nvm_default) {
            let version = version.trim();
            if !version.is_empty() {
                paths.insert(0, format!("{}/.nvm/versions/node/v{}/bin/openclaw", home_str, version));
            }
        }
        
        // fnm
        paths.push(format!("{}/.fnm/aliases/default/bin/openclaw", home_str));
        
        // volta
        paths.push(format!("{}/.volta/bin/openclaw", home_str));
        
        // pnpm 全局安装
        paths.push(format!("{}/.pnpm/bin/openclaw", home_str));
        paths.push(format!("{}/Library/pnpm/openclaw", home_str)); // macOS pnpm 默认路径
        
        // asdf
        paths.push(format!("{}/.asdf/shims/openclaw", home_str));
        
        // mise (formerly rtx)
        paths.push(format!("{}/.local/share/mise/shims/openclaw", home_str));
        
        // yarn 全局安装
        paths.push(format!("{}/.yarn/bin/openclaw", home_str));
        paths.push(format!("{}/.config/yarn/global/node_modules/.bin/openclaw", home_str));
    }
    
    paths
}

/// 获取 Windows 上可能的 openclaw 安装路径
fn get_windows_openclaw_paths() -> Vec<String> {
    let mut paths = Vec::new();
    
    // 1. nvm4w 安装路径
    paths.push("C:\\nvm4w\\nodejs\\openclaw.cmd".to_string());
    
    // 2. 用户目录下的 npm 全局路径
    if let Some(home) = dirs::home_dir() {
        let npm_path = format!("{}\\AppData\\Roaming\\npm\\openclaw.cmd", home.display());
        paths.push(npm_path);
    }
    
    // 3. Program Files 下的 nodejs
    paths.push("C:\\Program Files\\nodejs\\openclaw.cmd".to_string());
    
    paths
}

/// 获取 gateway bundle 目录下的入口文件路径
/// 返回 (bundle_dir, entry_point) 或 None
fn get_bundle_entry() -> Option<(String, String)> {
    if let Ok(bundle_dir) = std::env::var("OPENCLAW_GATEWAY_BUNDLE_DIR") {
        let entry = Path::new(&bundle_dir).join("openclaw.mjs");
        if entry.exists() {
            return Some((bundle_dir, entry.to_string_lossy().to_string()));
        }
        // 也检查 dist/entry.js（直接运行编译产物）
        let dist_entry = Path::new(&bundle_dir).join("dist").join("entry.js");
        if dist_entry.exists() {
            return Some((bundle_dir, dist_entry.to_string_lossy().to_string()));
        }
    }
    None
}

/// 执行 openclaw 命令并获取输出
/// 优先使用 bundle 目录中的 node + openclaw.mjs，回退到全局 openclaw 命令
pub fn run_openclaw(args: &[&str]) -> Result<String, String> {
    debug!("[Shell] 执行 openclaw 命令: {:?}", args);

    let extended_path = get_extended_path();
    let user_env_vars = load_openclaw_env_vars();

    // 优先使用 bundle 模式：node + openclaw.mjs
    if let (Some(node_path), Some((bundle_dir, entry_point))) = (get_node_path(), get_bundle_entry()) {
        debug!("[Shell] bundle 模式: node={}, entry={}, dir={}", node_path, entry_point, bundle_dir);

        let mut cmd = Command::new(&node_path);
        cmd.arg(&entry_point);
        cmd.args(args);
        cmd.current_dir(&bundle_dir);
        cmd.env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN);
        cmd.env("PATH", &extended_path);
        for (key, value) in &user_env_vars {
            cmd.env(key, value);
        }

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        return match cmd.output() {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                debug!("[Shell] 命令退出码: {:?}", out.status.code());
                if out.status.success() {
                    Ok(stdout)
                } else {
                    Err(format!("{}\n{}", stdout, stderr).trim().to_string())
                }
            }
            Err(e) => Err(format!("执行失败: {}", e)),
        };
    }

    // 回退：使用全局 openclaw 命令
    let openclaw_path = get_openclaw_path().ok_or_else(|| {
        warn!("[Shell] 找不到 openclaw（bundle 和全局都不可用）");
        "找不到 openclaw，请确保项目已构建（pnpm build）且 Node.js 已安装".to_string()
    })?;

    debug!("[Shell] 回退到全局 openclaw: {}", openclaw_path);

    let output = if openclaw_path.ends_with(".cmd") {
        let mut cmd_args = vec!["/c", &openclaw_path];
        cmd_args.extend(args);
        let mut cmd = Command::new("cmd");
        cmd.args(&cmd_args)
            .env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN)
            .env("PATH", &extended_path);
        for (key, value) in &user_env_vars {
            cmd.env(key, value);
        }

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.output()
    } else {
        let mut cmd = Command::new(&openclaw_path);
        cmd.args(args)
            .env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN)
            .env("PATH", &extended_path);
        for (key, value) in &user_env_vars {
            cmd.env(key, value);
        }

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            debug!("[Shell] 命令退出码: {:?}", out.status.code());
            if out.status.success() {
                Ok(stdout)
            } else {
                Err(format!("{}\n{}", stdout, stderr).trim().to_string())
            }
        }
        Err(e) => {
            warn!("[Shell] 执行 openclaw 失败: {}", e);
            Err(format!("执行 openclaw 失败: {}", e))
        }
    }
}

/// 默认的 Gateway Token
pub const DEFAULT_GATEWAY_TOKEN: &str = "openclaw-manager-local-token";

/// 从 ~/.openclaw/env 文件读取所有环境变量
/// 与 shell 脚本 `source ~/.openclaw/env` 行为一致
pub fn load_openclaw_env_vars() -> HashMap<String, String> {
    let mut env_vars = HashMap::new();
    let env_path = platform::get_env_file_path();
    
    if let Ok(content) = file::read_file(&env_path) {
        for line in content.lines() {
            let line = line.trim();
            // 跳过注释和空行
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // 解析 export KEY=VALUE 或 KEY=VALUE 格式
            let line = line.strip_prefix("export ").unwrap_or(line);
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                // 去除值周围的引号
                let value = value.trim()
                    .trim_matches('"')
                    .trim_matches('\'');
                env_vars.insert(key.to_string(), value.to_string());
            }
        }
    }
    
    env_vars
}

/// 后台启动 openclaw gateway
/// 与 shell 脚本行为一致：先加载 env 文件，再启动 gateway
pub fn spawn_openclaw_gateway() -> io::Result<()> {
    let _child = spawn_openclaw_gateway_with_handle()?;
    Ok(())
}

/// 后台启动 openclaw gateway 并返回 Child handle
/// 优先使用 bundle 模式（node + openclaw.mjs），回退到全局 openclaw 命令
pub fn spawn_openclaw_gateway_with_handle() -> io::Result<std::process::Child> {
    info!("[Shell] 后台启动 openclaw gateway (with handle)...");

    let user_env_vars = load_openclaw_env_vars();
    info!("[Shell] 已加载 {} 个环境变量", user_env_vars.len());

    let extended_path = get_extended_path();

    // 优先使用 bundle 模式：node + openclaw.mjs
    if let (Some(node_path), Some((bundle_dir, entry_point))) = (get_node_path(), get_bundle_entry()) {
        info!("[Shell] bundle 模式启动 gateway: node={}, entry={}, dir={}", node_path, entry_point, bundle_dir);

        let mut cmd = Command::new(&node_path);
        cmd.arg(&entry_point);
        cmd.args(["gateway", "--port", "18789"]);
        cmd.current_dir(&bundle_dir);

        for (key, value) in &user_env_vars {
            cmd.env(key, value);
        }
        cmd.env("PATH", &extended_path);
        cmd.env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN);

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        info!("[Shell] 启动 gateway 进程...");
        return match cmd.spawn() {
            Ok(child) => {
                info!("[Shell] Gateway 进程已启动, PID: {}", child.id());
                Ok(child)
            }
            Err(e) => {
                warn!("[Shell] Gateway 启动失败 (bundle 模式): {}", e);
                Err(io::Error::new(
                    e.kind(),
                    format!("启动失败 (node={}, entry={}): {}", node_path, entry_point, e)
                ))
            }
        };
    }

    // 回退：使用全局 openclaw 命令
    let openclaw_path = get_openclaw_path().ok_or_else(|| {
        warn!("[Shell] 找不到 openclaw（bundle 和全局都不可用）");
        io::Error::new(
            io::ErrorKind::NotFound,
            "找不到 openclaw，请确保项目已构建（pnpm build）且 Node.js 已安装"
        )
    })?;

    info!("[Shell] 回退到全局 openclaw: {}", openclaw_path);

    let mut cmd = if openclaw_path.ends_with(".cmd") {
        let mut c = Command::new("cmd");
        c.args(["/c", &openclaw_path, "gateway", "--port", "18789"]);
        c
    } else {
        let mut c = Command::new(&openclaw_path);
        c.args(["gateway", "--port", "18789"]);
        c
    };

    for (key, value) in &user_env_vars {
        cmd.env(key, value);
    }
    cmd.env("PATH", &extended_path);
    cmd.env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    info!("[Shell] 启动 gateway 进程...");
    match cmd.spawn() {
        Ok(child) => {
            info!("[Shell] Gateway 进程已启动, PID: {}", child.id());
            Ok(child)
        }
        Err(e) => {
            warn!("[Shell] Gateway 启动失败: {}", e);
            Err(io::Error::new(
                e.kind(),
                format!("启动失败 (路径: {}): {}", openclaw_path, e)
            ))
        }
    }
}

/// 检查命令是否存在
pub fn command_exists(cmd: &str) -> bool {
    if platform::is_windows() {
        // Windows: 使用 where 命令
        let mut command = Command::new("where");
        command.arg(cmd);
        
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        
        command.output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        // Unix: 使用 which 命令
        Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
