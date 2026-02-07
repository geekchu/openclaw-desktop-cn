use std::net::TcpStream;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;
use log::{info, warn, error};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

use crate::utils::shell;
use crate::TrayState;

/// Gateway 进程管理器
/// 负责启动、停止、健康检查 openclaw gateway 子进程
pub struct GatewayManager {
    child: Mutex<Option<Child>>,
    port: u16,
}

impl GatewayManager {
    pub fn new(port: u16) -> Self {
        Self {
            child: Mutex::new(None),
            port,
        }
    }

    /// 启动 gateway 子进程
    pub fn start(&self) -> Result<(), String> {
        info!("[Gateway] 启动 gateway 进程...");

        let child = shell::spawn_openclaw_gateway_with_handle()
            .map_err(|e| format!("启动 gateway 失败: {}", e))?;

        info!("[Gateway] gateway 进程已启动, PID: {}", child.id());

        let mut guard = self.child.lock().unwrap();
        *guard = Some(child);

        Ok(())
    }

    /// 停止 gateway 子进程
    pub fn stop(&self) {
        info!("[Gateway] 停止 gateway 进程...");

        // 先尝试优雅停止
        let _ = shell::run_openclaw(&["gateway", "stop"]);
        std::thread::sleep(Duration::from_secs(1));

        // 检查子进程是否还在运行，force kill
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    info!("[Gateway] gateway 进程已退出");
                }
                Ok(None) => {
                    // 进程仍在运行，强制终止
                    warn!("[Gateway] gateway 进程未响应停止信号，强制终止");
                    let _ = child.kill();
                    let _ = child.wait();
                }
                Err(e) => {
                    warn!("[Gateway] 检查进程状态失败: {}", e);
                    let _ = child.kill();
                }
            }
        }
        *guard = None;
        info!("[Gateway] gateway 进程已停止");
    }

    /// 检查 gateway 是否就绪（TCP 端口可连接）
    pub fn is_ready(&self) -> bool {
        let addr = format!("127.0.0.1:{}", self.port);
        TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(500),
        ).is_ok()
    }

    /// 轮询等待 gateway 就绪，最多等待 timeout_secs 秒
    pub fn wait_for_ready(&self, timeout_secs: u64) -> bool {
        for i in 1..=timeout_secs {
            if self.is_ready() {
                info!("[Gateway] gateway 已就绪 ({}秒)", i);
                return true;
            }

            // 检查子进程是否意外退出
            let mut guard = self.child.lock().unwrap();
            if let Some(ref mut child) = *guard {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        error!("[Gateway] gateway 进程意外退出, 退出码: {:?}", status.code());
                        return false;
                    }
                    Ok(None) => {} // 仍在运行
                    Err(e) => {
                        warn!("[Gateway] 检查进程状态失败: {}", e);
                    }
                }
            }
            drop(guard);

            std::thread::sleep(Duration::from_secs(1));
        }
        false
    }

    /// 检查子进程是否仍在运行
    fn is_child_alive(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(Some(_)) => false, // 已退出
                Ok(None) => true,     // 仍在运行
                Err(_) => false,
            }
        } else {
            false
        }
    }
}

/// 更新托盘菜单项，反映 gateway 当前状态
fn update_tray_status(handle: &AppHandle, running: bool) {
    if let Some(tray) = handle.try_state::<TrayState>() {
        if running {
            let _ = tray.status_item.set_text("Gateway: 运行中");
            let _ = tray.start_item.set_enabled(false);
            let _ = tray.stop_item.set_enabled(true);
            let _ = tray.restart_item.set_enabled(true);
        } else {
            let _ = tray.status_item.set_text("Gateway: 已停止");
            let _ = tray.start_item.set_enabled(true);
            let _ = tray.stop_item.set_enabled(false);
            let _ = tray.restart_item.set_enabled(false);
        }
    }
}

/// 健康检查循环：每 10 秒检查一次 gateway 状态
/// 如果 gateway 不响应且子进程已退出，自动尝试重启（最多 3 次连续失败后退避）
pub fn health_check_loop(handle: &AppHandle) {
    let check_interval = Duration::from_secs(10);
    let max_consecutive_failures = 3;
    let backoff_interval = Duration::from_secs(60);
    let mut consecutive_failures: u32 = 0;

    loop {
        let wait = if consecutive_failures >= max_consecutive_failures {
            backoff_interval
        } else {
            check_interval
        };
        std::thread::sleep(wait);

        let gm = handle.state::<GatewayManager>();

        if gm.is_ready() {
            consecutive_failures = 0;
            update_tray_status(handle, true);
            continue; // 正常运行
        }

        // gateway 未响应
        warn!("[Gateway] 健康检查：gateway 未响应");
        update_tray_status(handle, false);

        if gm.is_child_alive() {
            // 子进程还在但端口不通——可能正在重启，等一轮再看
            info!("[Gateway] 子进程仍在运行，等待下一轮检查");
            continue;
        }

        // 子进程已退出，尝试重启
        warn!("[Gateway] 子进程已退出，尝试自动重启...");
        let _ = handle.emit("gateway-status", "Gateway 已断开，正在重启...");

        match gm.start() {
            Ok(_) => {
                let _ = handle.emit("gateway-status", "正在等待 Gateway 重启...");
                if gm.wait_for_ready(15) {
                    info!("[Gateway] 自动重启成功");
                    consecutive_failures = 0;
                    update_tray_status(handle, true);
                    // 重新读取 token 以确保认证正常
                    let url = match crate::read_gateway_token() {
                        Some(token) => format!("http://localhost:{}?token={}", gm.port, token),
                        None => format!("http://localhost:{}", gm.port),
                    };
                    let _ = handle.emit("gateway-ready", url.as_str());
                } else {
                    consecutive_failures += 1;
                    error!("[Gateway] 自动重启超时 (连续失败 {}次)", consecutive_failures);
                    let _ = handle.emit("gateway-status", "Gateway 重启超时");
                    update_tray_status(handle, false);
                }
            }
            Err(e) => {
                consecutive_failures += 1;
                error!("[Gateway] 自动重启失败 (连续失败 {}次): {}", consecutive_failures, e);
                update_tray_status(handle, false);
                if consecutive_failures >= max_consecutive_failures {
                    let _ = handle.emit("gateway-status",
                        "Gateway 启动失败，已进入低频重试模式");
                } else {
                    let _ = handle.emit("gateway-status", format!("重启失败: {}", e).as_str());
                }
            }
        }
    }
}
