use crate::models::ServiceStatus;
use crate::utils::shell;
use crate::gateway::GatewayManager;
use tauri::{command, AppHandle, Manager};
use std::process::Command;
use log::{info, warn};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows CREATE_NO_WINDOW 标志，用于隐藏控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 检测端口是否有服务在监听，返回 PID
/// 简单直接：端口被占用 = 服务运行中
fn check_port_listening(port: u16) -> Option<u32> {
    #[cfg(unix)]
    {
        let output = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
            .ok()?;
        
        if output.status.success() {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .and_then(|line| line.trim().parse::<u32>().ok())
        } else {
            None
        }
    }
    
    #[cfg(windows)]
    {
        let mut cmd = Command::new("netstat");
        cmd.args(["-ano"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        
        let output = cmd.output().ok()?;
        
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                    if let Some(pid_str) = line.split_whitespace().last() {
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            return Some(pid);
                        }
                    }
                }
            }
        }
        None
    }
}

/// 获取进程的内存使用量 (MB) — Windows 使用 tasklist
#[cfg(windows)]
fn get_process_memory_mb(pid: u32) -> Option<f64> {
    let mut cmd = Command::new("tasklist");
    cmd.args(["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // CSV 格式: "name","pid","session","session#","mem"
        // mem 格式如 "123,456 K"
        for line in stdout.lines() {
            if line.contains(&pid.to_string()) {
                let parts: Vec<&str> = line.split('"').collect();
                // parts[9] 通常是内存值（第5个引号对的内容）
                if parts.len() >= 10 {
                    let mem_str = parts[9].replace(',', "").replace(" K", "").replace(" k", "").trim().to_string();
                    if let Ok(kb) = mem_str.parse::<f64>() {
                        return Some(kb / 1024.0);
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn get_process_memory_mb(pid: u32) -> Option<f64> {
    // ps -o rss= -p PID → KB
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if output.status.success() {
        let kb: f64 = String::from_utf8_lossy(&output.stdout).trim().parse().ok()?;
        Some(kb / 1024.0)
    } else {
        None
    }
}

/// 获取进程的运行时间（秒）— Windows 使用 wmic
#[cfg(windows)]
fn get_process_uptime_seconds(pid: u32) -> Option<u64> {
    let mut cmd = Command::new("powershell");
    cmd.args(["-Command", &format!(
        "(New-TimeSpan -Start (Get-Process -Id {} -ErrorAction SilentlyContinue).StartTime -End (Get-Date)).TotalSeconds",
        pid
    )]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().ok()?;
    if output.status.success() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        s.parse::<f64>().ok().map(|v| v as u64)
    } else {
        None
    }
}

#[cfg(not(windows))]
fn get_process_uptime_seconds(pid: u32) -> Option<u64> {
    // ps -o etimes= -p PID → elapsed seconds
    let output = Command::new("ps")
        .args(["-o", "etimes=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if output.status.success() {
        String::from_utf8_lossy(&output.stdout).trim().parse().ok()
    } else {
        None
    }
}

/// 获取服务状态（简单版：直接检查端口占用）
#[command]
pub async fn get_service_status(app: AppHandle) -> Result<ServiceStatus, String> {
    // 从 GatewayManager 获取当前端口
    let gm = app.state::<GatewayManager>();
    let port = gm.get_port();

    // 简单直接：检查端口是否被占用
    let pid = check_port_listening(port);
    let running = pid.is_some();

    let memory_mb = pid.and_then(get_process_memory_mb);
    let uptime_seconds = pid.and_then(get_process_uptime_seconds);

    Ok(ServiceStatus {
        running,
        pid,
        port,
        uptime_seconds,
        memory_mb,
        cpu_percent: None,
    })
}

/// 启动服务
#[command]
pub async fn start_service(app: AppHandle) -> Result<String, String> {
    info!("[服务] 启动服务...");

    // 检查是否已经运行
    let status = get_service_status(app.clone()).await?;
    if status.running {
        info!("[服务] 服务已在运行中");
        return Err("服务已在运行中".to_string());
    }
    
    // 检查 openclaw 是否可用（bundle 模式或全局命令）
    let bundle_ok = shell::get_bundle_entry().is_some() && shell::get_node_path().is_some();
    if !bundle_ok {
        if cfg!(debug_assertions) {
            // 开发模式：回退检查全局 openclaw
            if shell::get_openclaw_path().is_none() {
                info!("[服务] [开发模式] 找不到 openclaw 命令");
                return Err("找不到 openclaw 命令，请确保项目已构建（pnpm build）且 Node.js 已安装".to_string());
            }
        } else {
            // 生产模式：不回退，提示重新安装
            info!("[服务] 生产模式下 bundle 不可用");
            return Err("内置 openclaw 不可用，请重新安装应用".to_string());
        }
    }
    
    // 直接后台启动 gateway，通过 GatewayManager 绝对控股 PID
    info!("[服务] 后台集权管理启动 gateway...");
    let gm = app.state::<GatewayManager>();
    let port = gm.start().map_err(|e| format!("启动服务失败: {}", e))?;

    // 轮询等待端口开始监听及 HTTP 就绪（最多 60 秒）
    info!("[服务] 等待 Gateway HTTP 存活探活 (60秒), 端口: {}...", port);
    if gm.wait_for_ready(60) {
        // 启动成功，通知前端重新导航
        crate::gateway::navigate_webview_to_gateway(&app, port);
        
        if let Some(pid) = check_port_listening(port) {
            info!("[服务] ✓ 启动成功, PID: {}, 端口: {}", pid, port);
            return Ok(format!("服务已启动，PID: {}, 端口: {}", pid, port));
        }
        info!("[服务] ✓ HTTP已就绪，但端口识别延迟");
        return Ok(format!("服务已启动，端口: {}", port));
    }
    
    info!("[服务] 等待超时，HTTP 或端口仍未就绪");
    Err("服务启动超时（60秒），请检查 openclaw 日志".to_string())
}

/// 停止服务
#[command]
pub async fn stop_service(app: AppHandle) -> Result<String, String> {
    info!("[服务] 停止服务...");

    let gm = app.state::<GatewayManager>();
    gm.set_suppress_restart(true);
    gm.stop();
    gm.set_suppress_restart(false);

    std::thread::sleep(std::time::Duration::from_millis(500));

    let status = get_service_status(app).await?;
    if status.running {
        Err(format!("无法停止服务，PID: {:?}", status.pid))
    } else {
        info!("[服务] ✓ 已停止");
        Ok("服务已停止".to_string())
    }
}

/// 强制杀死占用指定端口的进程
fn force_kill_port_holder(port: u16) {
    if let Some(pid) = check_port_listening(port) {
        warn!("[服务] 端口 {} 仍被 PID {} 占用，强制终止", port, pid);
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        #[cfg(unix)]
        {
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
        }
        // 等待进程退出、端口释放
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

/// 停止 Gateway 子进程（用于更新前清理）
/// 先通过 GatewayManager 优雅停止，再检查端口确保无残留进程
#[command]
pub async fn stop_gateway(app: AppHandle) -> Result<(), String> {
    info!("[服务] 更新前停止 Gateway...");
    let gm = app.state::<GatewayManager>();
    let port = gm.get_port();
    // 抑制健康检查线程自动重启，防止安装期间 gateway 被拉起
    gm.set_suppress_restart(true);
    gm.stop();
    std::thread::sleep(std::time::Duration::from_secs(1));

    // 兜底：如果端口仍被占用（孤儿进程、上次崩溃残留等），强制杀掉
    force_kill_port_holder(port);

    info!("[服务] Gateway 已停止，可以安全更新");
    Ok(())
}

/// 重启服务 — 通过 GatewayManager 管理子进程
#[command]
pub async fn restart_service(app: AppHandle) -> Result<String, String> {
    info!("[服务] 重启服务...");

    let gm = app.state::<GatewayManager>();
    gm.stop();
    std::thread::sleep(std::time::Duration::from_secs(1));

    let port = gm.start().map_err(|e| format!("重启 Gateway 失败: {}", e))?;

    if gm.wait_for_ready(60) {
        // 重启成功，通知前端重新导航
        crate::gateway::navigate_webview_to_gateway(&app, port);
        info!("[服务] ✓ 重启成功，端口: {}", port);
        Ok(format!("服务已重启，端口: {}", port))
    } else {
        Err("Gateway 重启超时（60秒）".to_string())
    }
}

/// 获取日志 — 直接读取 gateway 日志文件
#[command]
pub async fn get_logs(lines: Option<u32>) -> Result<Vec<String>, String> {
    let n = lines.unwrap_or(100) as usize;

    // Gateway 写入的日志文件路径:
    //   POSIX: /tmp/openclaw/openclaw-YYYY-MM-DD.log
    //   Windows: %TEMP%/openclaw/openclaw-YYYY-MM-DD.log (与 Node.js os.tmpdir() 一致)
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    #[cfg(windows)]
    let log_path = {
        let tmp = std::env::temp_dir();
        format!("{}\\openclaw\\openclaw-{}.log", tmp.display(), today)
    };
    #[cfg(not(windows))]
    let log_path = format!("/tmp/openclaw/openclaw-{}.log", today);

    match std::fs::read_to_string(&log_path) {
        Ok(content) => {
            let all_lines: Vec<String> = content
                .lines()
                .filter_map(|line| {
                    // 日志是 JSON 格式，提取可读信息
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                        let time = v.get("time")
                            .and_then(|t| t.as_str())
                            .unwrap_or("");
                        let level = v.get("_meta")
                            .and_then(|m| m.get("logLevelName"))
                            .and_then(|l| l.as_str())
                            .unwrap_or("INFO");
                        let msg = v.get("1")
                            .and_then(|m| m.as_str())
                            .or_else(|| v.get("0").and_then(|m| m.as_str()))
                            .unwrap_or("");
                        if msg.is_empty() {
                            return None;
                        }
                        // 提取时间的 HH:MM:SS 部分
                        let short_time = if time.len() >= 19 {
                            &time[11..19]
                        } else {
                            time
                        };
                        Some(format!("[{}] [{}] {}", short_time, level, msg))
                    } else {
                        // 非 JSON 行，原样返回
                        Some(line.to_string())
                    }
                })
                .collect();
            // 取最后 n 行
            let start = if all_lines.len() > n { all_lines.len() - n } else { 0 };
            Ok(all_lines[start..].to_vec())
        }
        Err(_) => {
            Ok(vec!["暂无日志文件".to_string()])
        }
    }
}
