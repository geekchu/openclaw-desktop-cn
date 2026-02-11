use crate::models::ServiceStatus;
use crate::utils::shell;
use crate::gateway::GatewayManager;
use tauri::{command, AppHandle, Emitter, Manager};
use std::process::Command;
use log::{info, debug};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows CREATE_NO_WINDOW 标志，用于隐藏控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const SERVICE_PORT: u16 = 18789;

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
pub async fn get_service_status() -> Result<ServiceStatus, String> {
    // 简单直接：检查端口是否被占用
    let pid = check_port_listening(SERVICE_PORT);
    let running = pid.is_some();

    let memory_mb = pid.and_then(get_process_memory_mb);
    let uptime_seconds = pid.and_then(get_process_uptime_seconds);

    Ok(ServiceStatus {
        running,
        pid,
        port: SERVICE_PORT,
        uptime_seconds,
        memory_mb,
        cpu_percent: None,
    })
}

/// 启动服务
#[command]
pub async fn start_service() -> Result<String, String> {
    info!("[服务] 启动服务...");
    
    // 检查是否已经运行
    let status = get_service_status().await?;
    if status.running {
        info!("[服务] 服务已在运行中");
        return Err("服务已在运行中".to_string());
    }
    
    // 检查 openclaw 命令是否存在
    let openclaw_path = shell::get_openclaw_path();
    if openclaw_path.is_none() {
        info!("[服务] 找不到 openclaw 命令");
        return Err("找不到 openclaw 命令，请先通过 npm install -g openclaw 安装".to_string());
    }
    info!("[服务] openclaw 路径: {:?}", openclaw_path);
    
    // 直接后台启动 gateway（不等待 doctor，避免阻塞）
    info!("[服务] 后台启动 gateway...");
    shell::spawn_openclaw_gateway()
        .map_err(|e| format!("启动服务失败: {}", e))?;
    
    // 轮询等待端口开始监听（最多 15 秒）
    info!("[服务] 等待端口 {} 开始监听...", SERVICE_PORT);
    for i in 1..=15 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Some(pid) = check_port_listening(SERVICE_PORT) {
            info!("[服务] ✓ 启动成功 ({}秒), PID: {}", i, pid);
            return Ok(format!("服务已启动，PID: {}", pid));
        }
        if i % 3 == 0 {
            debug!("[服务] 等待中... ({}秒)", i);
        }
    }
    
    info!("[服务] 等待超时，端口仍未监听");
    Err("服务启动超时（15秒），请检查 openclaw 日志".to_string())
}

/// 停止服务
#[command]
pub async fn stop_service() -> Result<String, String> {
    info!("[服务] 停止服务...");
    
    let _ = shell::run_openclaw(&["gateway", "stop"]);
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    let status = get_service_status().await?;
    if !status.running {
        info!("[服务] ✓ 已停止");
        return Ok("服务已停止".to_string());
    }
    
    // 尝试强制停止
    let _ = shell::run_openclaw(&["gateway", "stop", "--force"]);
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    let status = get_service_status().await?;
    if status.running {
        Err(format!("无法停止服务，PID: {:?}", status.pid))
    } else {
        info!("[服务] ✓ 已停止");
        Ok("服务已停止".to_string())
    }
}

/// 重启服务 — 通过 GatewayManager 管理子进程
#[command]
pub async fn restart_service(app: AppHandle) -> Result<String, String> {
    info!("[服务] 重启服务...");

    let gm = app.state::<GatewayManager>();
    gm.stop();
    std::thread::sleep(std::time::Duration::from_secs(1));

    gm.start().map_err(|e| format!("重启 Gateway 失败: {}", e))?;

    if gm.wait_for_ready(15) {
        // 重启成功，通知前端重新导航
        let url = match crate::read_gateway_token() {
            Some(token) => format!("http://localhost:{}?token={}", 18789, token),
            None => format!("http://localhost:{}", 18789),
        };
        let _ = app.emit("gateway-ready", url.as_str());
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.navigate(url.parse().unwrap());
        }
        info!("[服务] ✓ 重启成功");
        Ok("服务已重启".to_string())
    } else {
        Err("Gateway 重启超时（15秒）".to_string())
    }
}

/// 获取日志 — 直接读取 gateway 日志文件
#[command]
pub async fn get_logs(lines: Option<u32>) -> Result<Vec<String>, String> {
    let n = lines.unwrap_or(100) as usize;

    // Gateway 写入的日志文件路径: \tmp\openclaw\openclaw-YYYY-MM-DD.log (Windows)
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    #[cfg(windows)]
    let log_path = format!("\\tmp\\openclaw\\openclaw-{}.log", today);
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
