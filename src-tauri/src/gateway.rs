use std::net::TcpStream;
use std::process::Child;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::time::Duration;
use log::{info, warn, error};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

use crate::utils::shell;
use crate::TrayState;

/// 默认端口
pub const DEFAULT_PORT: u16 = 28789;
/// 最小端口（向下搜索的下限）
pub const MIN_PORT: u16 = 28700;

/// 全局共享的 Gateway 端口引用，供不依赖 Tauri AppHandle 的底层的 shell 脚本直接获取
pub static GLOBAL_GATEWAY_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(28789);

/// Gateway 进程管理器
/// 负责启动、停止、健康检查 openclaw gateway 子进程
pub struct GatewayManager {
    child: Mutex<Option<Child>>,
    /// 当前使用的端口（可能因端口占用而动态变化）
    port: AtomicU16,
    /// 更新期间设置为 true，阻止健康检查线程自动重启 gateway
    suppress_restart: AtomicBool,
    /// 最后一次引导前端 WebView 导航过的有效端口
    last_navigated_port: AtomicU16,
}

impl GatewayManager {
    pub fn new(port: u16) -> Self {
        Self {
            child: Mutex::new(None),
            port: AtomicU16::new(port),
            suppress_restart: AtomicBool::new(false),
            last_navigated_port: AtomicU16::new(0),
        }
    }

    pub fn get_last_navigated_port(&self) -> u16 {
        self.last_navigated_port.load(Ordering::SeqCst)
    }

    pub fn set_last_navigated_port(&self, port: u16) {
        self.last_navigated_port.store(port, Ordering::SeqCst);
    }

    /// 获取当前使用的端口
    pub fn get_port(&self) -> u16 {
        self.port.load(Ordering::SeqCst)
    }

    /// 设置端口
    fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::SeqCst);
        GLOBAL_GATEWAY_PORT.store(port, Ordering::SeqCst);
    }

    /// 设置抑制自动重启标志（更新前调用）
    pub fn set_suppress_restart(&self, val: bool) {
        self.suppress_restart.store(val, Ordering::SeqCst);
    }

    /// 检查是否抑制自动重启
    pub fn is_restart_suppressed(&self) -> bool {
        self.suppress_restart.load(Ordering::SeqCst)
    }

    pub fn start(&self) -> Result<u16, String> {
        let mut guard = self.child.lock().unwrap();

        // 检查之前是否已经拉起了存活的底层终端句柄，如果有则拦截覆盖
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(None) => {
                    info!("[Gateway] 进程句柄已在追踪运行状态中，拦截并发启动");
                    return Ok(self.get_port());
                }
                _ => {} // 已抛弃或已死亡的僵尸，允许覆写注入新的
            }
        }

        info!("[Gateway] 启动 gateway 进程...");

        // 查找可用端口
        let port = shell::find_available_port(DEFAULT_PORT, MIN_PORT)
            .ok_or_else(|| format!("在 {}-{} 范围内未找到可用端口", MIN_PORT, DEFAULT_PORT))?;

        if port != DEFAULT_PORT {
            info!("[Gateway] 默认端口 {} 被占用，使用端口 {}", DEFAULT_PORT, port);
        }

        let child = shell::spawn_openclaw_gateway_with_handle(port)
            .map_err(|e| format!("启动 gateway 失败: {}", e))?;

        info!("[Gateway] gateway 进程已启动, PID: {}, 端口: {}", child.id(), port);

        self.set_port(port);
        *guard = Some(child);

        Ok(port)
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
                    #[cfg(target_os = "windows")]
                    {
                        use std::os::windows::process::CommandExt;
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/PID", &child.id().to_string()])
                            .creation_flags(0x08000000)
                            .status();
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                }
                Err(e) => {
                    warn!("[Gateway] 检查进程状态失败: {}", e);
                    #[cfg(target_os = "windows")]
                    {
                        use std::os::windows::process::CommandExt;
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/PID", &child.id().to_string()])
                            .creation_flags(0x08000000)
                            .status();
                    }
                    let _ = child.kill();
                }
            }
        }
        *guard = None;
        info!("[Gateway] gateway 进程已停止");
    }

    /// 检查 gateway 是否就绪（HTTP 请求可响应）
    /// 发送简单 HTTP 请求而非仅检查 TCP，确保 gateway 的完整中间件栈
    /// （包括 auth、config、设备配对模块）已全部初始化
    pub fn is_ready(&self) -> bool {
        use std::io::{Read, Write};
        let port = self.get_port();
        let addr = format!("127.0.0.1:{}", port);
        let mut stream = match TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(500),
        ) {
            Ok(s) => s,
            Err(e) => {
                warn!("[Gateway] is_ready: TCP 连接失败: {}", e);
                return false;
            }
        };
        let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
        // 发送最简 HTTP 请求
        let request = format!("GET / HTTP/1.0\r\nHost: 127.0.0.1:{}\r\n\r\n", port);
        if let Err(e) = stream.write_all(request.as_bytes()) {
            warn!("[Gateway] is_ready: HTTP 请求发送失败: {}", e);
            return false;
        }
        // 只需读到 HTTP 响应头即可确认 gateway 完全就绪
        let mut buf = [0u8; 16];
        match stream.read(&mut buf) {
            Ok(n) if n >= 4 => {
                let response = String::from_utf8_lossy(&buf[..n]);
                let ready = response.starts_with("HTTP/");
                if ready {
                    info!("[Gateway] is_ready: 收到 HTTP 响应，gateway 就绪");
                } else {
                    warn!("[Gateway] is_ready: 响应不是 HTTP: {:?}", response);
                }
                ready
            }
            Ok(n) => {
                warn!("[Gateway] is_ready: 响应太短 ({} bytes)", n);
                false
            }
            Err(e) => {
                warn!("[Gateway] is_ready: 读取响应失败: {}", e);
                false
            }
        }
    }

    /// 轮询等待 gateway 就绪，最多等待 timeout_secs 秒
    /// 需要连续多次检测到就绪状态才确认（避免在插件加载阻塞前的短暂窗口误判为就绪）
    pub fn wait_for_ready(&self, timeout_secs: u64) -> bool {
        let poll_interval = Duration::from_millis(50);
        let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
        let mut last_child_check = std::time::Instant::now();

        loop {
            if self.is_ready() {
                let elapsed = std::time::Instant::now().duration_since(deadline - Duration::from_secs(timeout_secs));
                info!("[Gateway] gateway 已就绪 ({:.1}秒)", elapsed.as_secs_f64());
                return true;
            }

            if std::time::Instant::now() >= deadline {
                return false;
            }

            // 每秒检查一次子进程是否意外退出（不必每次 poll 都检查）
            if last_child_check.elapsed() >= Duration::from_secs(1) {
                last_child_check = std::time::Instant::now();
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
            }

            std::thread::sleep(poll_interval);
        }
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

/// 发送系统桌面通知
fn send_notification(handle: &AppHandle, body: &str) {
    let _ = handle.notification()
        .builder()
        .title("OpenClaw桌面版")
        .body(body)
        .show();
}

/// 首次启动超时通知（供 main.rs 调用）
pub fn send_startup_timeout_notification(handle: &AppHandle) {
    send_notification(handle, "Gateway 启动超时，请检查 Node.js 环境");
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
/// `already_navigated`: 启动线程是否已经成功导航到 gateway URL
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
            // 检查是否需要导航（如果之前未导航过，或是端口发生了变换）
            let current_port = gm.get_port();

            if gm.get_last_navigated_port() != current_port {
                info!("[Gateway] 健康检查发现 gateway 就绪且端口需更新，执行导航到新端口");
                navigate_webview_to_gateway(handle, current_port);
            }
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

        // 更新期间不自动重启，避免与安装程序冲突
        if gm.is_restart_suppressed() {
            info!("[Gateway] 自动重启已抑制（更新中），跳过");
            continue;
        }

        // 子进程已退出，尝试重启
        warn!("[Gateway] 子进程已退出，尝试自动重启...");
        let _ = handle.emit("gateway-status", "Gateway 已断开，正在重启...");

        match gm.start() {
            Ok(port) => {
                let _ = handle.emit("gateway-status", "正在等待 Gateway 重启...");
                if gm.wait_for_ready(60) {
                    info!("[Gateway] 自动重启成功，端口: {}", port);
                    consecutive_failures = 0;
                    update_tray_status(handle, true);
                    send_notification(handle, &format!("Gateway 已自动重启 (端口 {})", port));
                    navigate_webview_to_gateway(handle, port);
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
                    send_notification(handle, "Gateway 启动失败，已进入低频重试模式");
                } else {
                    let _ = handle.emit("gateway-status", format!("重启失败: {}", e).as_str());
                }
            }
        }
    }
}

/// 统一的 WebView 导航助手函数，带防抖保护避免冗余跳转
pub fn navigate_webview_to_gateway(handle: &AppHandle, port: u16) {
    let gm = handle.state::<GatewayManager>();
    if gm.get_last_navigated_port() == port {
        info!("[Gateway] navigate_webview_to_gateway: 防抖跳过 (port={})", port);
        return; // 防抖：如果在其它线程刚做过该端口的导航，就跳过
    }

    // 使用 127.0.0.1 而不是 localhost，避免某些 WebView 的安全限制
    let url = match crate::read_gateway_token() {
        Some(token) => {
            info!("[Gateway] navigate_webview_to_gateway: 使用 token");
            format!("http://127.0.0.1:{}?token={}", port, token)
        }
        None => {
            info!("[Gateway] navigate_webview_to_gateway: 无 token");
            format!("http://127.0.0.1:{}", port)
        }
    };

    info!("[Gateway] navigate_webview_to_gateway: 导航到 {}", url);
    let _ = handle.emit("gateway-ready", url.as_str());

    // 使用 JavaScript 执行导航，因为 window.navigate() 在某些情况下不生效
    if let Some(window) = handle.get_webview_window("main") {
        let js = format!("window.location.href = '{}';", url);
        match window.eval(&js) {
            Ok(_) => info!("[Gateway] navigate_webview_to_gateway: JS 导航已执行"),
            Err(e) => error!("[Gateway] navigate_webview_to_gateway: JS 导航失败: {}", e),
        }
    } else {
        error!("[Gateway] navigate_webview_to_gateway: 找不到 main 窗口");
    }

    gm.set_last_navigated_port(port);
}
