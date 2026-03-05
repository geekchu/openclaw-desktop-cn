use crate::utils::shell;
use tauri::command;
use log::{info, debug};

/// 检查 OpenClaw 是否已安装
/// 生产模式：仅检查 bundle 模式（内置 Node.js + openclaw.mjs）
/// 开发模式：bundle 优先，回退到全局 openclaw
#[command]
pub async fn check_openclaw_installed() -> Result<bool, String> {
    info!("[进程检查] 检查 OpenClaw 是否可用...");
    // 优先检查 bundle 目录中 openclaw.mjs 是否存在 + Node.js 是否可用
    let bundle_ok = std::env::var("OPENCLAW_GATEWAY_BUNDLE_DIR")
        .map(|dir| {
            std::path::Path::new(&dir).join("openclaw.mjs").exists()
            || std::path::Path::new(&dir).join("dist").join("entry.js").exists()
        })
        .unwrap_or(false);
    let node_ok = shell::get_node_path().is_some();

    if bundle_ok && node_ok {
        info!("[进程检查] OpenClaw 可用 (bundle 模式)");
        return Ok(true);
    }

    // 生产模式：不回退到全局 openclaw，打包应用必须自包含
    if !cfg!(debug_assertions) {
        info!("[进程检查] 生产模式下 bundle 不可用 (bundle_ok={}, node_ok={})", bundle_ok, node_ok);
        return Ok(false);
    }

    // 开发模式：回退到全局 openclaw 检查
    let installed = shell::get_openclaw_path().is_some();
    info!("[进程检查] [开发模式] OpenClaw 安装状态: {}", if installed { "已安装" } else { "未安装" });
    Ok(installed)
}

/// 获取 OpenClaw 版本
#[command]
pub async fn get_openclaw_version() -> Result<Option<String>, String> {
    info!("[进程检查] 获取 OpenClaw 版本...");
    // 使用 run_openclaw 来获取版本
    match shell::run_openclaw(&["--version"]) {
        Ok(version) => {
            let v = version.trim().to_string();
            info!("[进程检查] OpenClaw 版本: {}", v);
            Ok(Some(v))
        },
        Err(e) => {
            debug!("[进程检查] 获取版本失败: {}", e);
            Ok(None)
        },
    }
}

/// 检查端口是否被占用（通过尝试连接 openclaw gateway）
#[command]
pub async fn check_port_in_use(port: u16) -> Result<bool, String> {
    info!("[进程检查] 检查端口 {} 是否被占用...", port);
    
    // 使用 openclaw health 检查 gateway 是否在运行
    // 如果 port 是默认的 28789，直接使用 openclaw health
    if port == 28789 {
        debug!("[进程检查] 使用 openclaw health 检查端口 28789...");
        let result = shell::run_openclaw(&["health", "--timeout", "2000"]);
        // 如果 health 命令成功，说明端口被 gateway 占用
        let in_use = result.is_ok();
        info!("[进程检查] 端口 28789 状态: {}", if in_use { "被占用" } else { "空闲" });
        return Ok(in_use);
    }
    
    // 对于非默认端口，尝试使用 TCP 连接检查
    debug!("[进程检查] 使用 TCP 连接检查端口 {}...", port);
    use std::net::TcpStream;
    use std::time::Duration;
    
    let addr = format!("127.0.0.1:{}", port);
    match TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_millis(500)) {
        Ok(_) => {
            info!("[进程检查] 端口 {} 被占用", port);
            Ok(true)
        },
        Err(_) => {
            info!("[进程检查] 端口 {} 空闲", port);
            Ok(false)
        },
    }
}
