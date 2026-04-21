use log::{debug, error, info, warn};
use serde::Deserialize;
use std::fs::read_to_string;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU16, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
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
pub static GLOBAL_GATEWAY_PORT: std::sync::atomic::AtomicU16 =
    std::sync::atomic::AtomicU16::new(28789);

/// Gateway 进程管理器
/// 负责启动、停止、健康检查 openclaw gateway 子进程
pub struct GatewayManager {
    child: Mutex<Option<Child>>,
    /// 当前使用的端口（可能因端口占用而动态变化）
    port: AtomicU16,
    /// 当前桌面会话是否接管了一个已有的健康 gateway，而不是本进程亲自拉起的 child。
    adopted_existing_instance: AtomicBool,
    adopted_existing_pid: Mutex<Option<u32>>,
    /// 手动停止或更新期间设置为 true，阻止健康检查线程自动重启 gateway
    suppress_restart: AtomicBool,
    /// 用于取消旧的启动等待，避免 stop/restart/update 后后台线程继续死等。
    wait_cancel_epoch: AtomicU64,
    /// 当前活动中的启动等待数量，供健康检查跳过误判式重启。
    startup_wait_count: AtomicU64,
    startup_run_id: Mutex<Option<String>>,
    /// 最后一次引导前端 WebView 导航过的完整目标 URL
    last_navigated_url: Mutex<Option<String>>,
    /// 初始启动阶段标志：覆盖从 app setup 到第一次启动流程完成的整个周期，
    /// 防止健康检查线程在 gateway 尚未启动时就误判为"已停止"并触发自动重启。
    initial_startup_in_progress: AtomicBool,
    /// Gateway 上次就绪（HTTP 成功响应）的时间戳（Unix epoch millis），
    /// 用于在健康检查中实现 post-ready 宽限期。
    /// -1 表示 gateway 尚未就绪过。
    last_ready_epoch_ms: AtomicI64,
}

impl GatewayManager {
    pub fn new(port: u16) -> Self {
        Self {
            child: Mutex::new(None),
            port: AtomicU16::new(port),
            adopted_existing_instance: AtomicBool::new(false),
            adopted_existing_pid: Mutex::new(None),
            suppress_restart: AtomicBool::new(false),
            wait_cancel_epoch: AtomicU64::new(0),
            startup_wait_count: AtomicU64::new(0),
            startup_run_id: Mutex::new(None),
            last_navigated_url: Mutex::new(None),
            initial_startup_in_progress: AtomicBool::new(false),
            last_ready_epoch_ms: AtomicI64::new(-1),
        }
    }

    pub fn get_last_navigated_url(&self) -> Option<String> {
        self.last_navigated_url.lock().unwrap().clone()
    }

    pub fn set_last_navigated_url(&self, url: Option<String>) {
        *self.last_navigated_url.lock().unwrap() = url;
    }

    /// 标记初始启动阶段开始（整个 setup 到 gateway 就绪/失败的周期）
    pub fn set_initial_startup(&self, active: bool) {
        self.initial_startup_in_progress.store(active, Ordering::SeqCst);
    }

    /// 是否处于初始启动阶段
    pub fn is_initial_startup_in_progress(&self) -> bool {
        self.initial_startup_in_progress.load(Ordering::SeqCst)
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

    fn set_adopted_existing_instance(&self, value: bool) {
        self.adopted_existing_instance
            .store(value, Ordering::SeqCst);
    }

    fn set_adopted_existing_pid(&self, pid: Option<u32>) {
        *self.adopted_existing_pid.lock().unwrap() = pid;
    }

    fn get_adopted_existing_pid(&self) -> Option<u32> {
        *self.adopted_existing_pid.lock().unwrap()
    }

    fn set_startup_run_id(&self, run_id: Option<String>) {
        *self.startup_run_id.lock().unwrap() = run_id;
    }

    fn get_startup_run_id(&self) -> Option<String> {
        self.startup_run_id.lock().unwrap().clone()
    }

    fn current_startup_failure(&self) -> Option<String> {
        let run_id = self.get_startup_run_id()?;
        read_gateway_startup_failure(&run_id, self.get_port())
    }

    /// 记录 gateway 最近一次成功响应的时间戳（Unix epoch millis）。
    /// 供健康检查 post-ready 宽限期使用。
    fn mark_ready(&self) {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        self.last_ready_epoch_ms.store(now_ms, Ordering::SeqCst);
    }

    /// 距离 gateway 上次就绪已经过去的毫秒数。
    /// 如果从未就绪过返回 None。
    fn ms_since_last_ready(&self) -> Option<u64> {
        let last = self.last_ready_epoch_ms.load(Ordering::SeqCst);
        if last < 0 {
            return None;
        }
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        Some((now_ms - last).max(0) as u64)
    }

    fn has_live_adopted_gateway_instance(&self) -> bool {
        if !self.adopted_existing_instance.load(Ordering::SeqCst) {
            return false;
        }
        let current_port = self.get_port();
        let current_listener_pid = check_port_listening(current_port);
        match self.get_adopted_existing_pid() {
            Some(adopted_pid) => current_listener_pid == Some(adopted_pid),
            // PID 探测偶发失败时，至少保持“已接管且当前仍健康”的语义一致，
            // 并在条件满足时补记 PID，避免后续 stop() 无法精确清理该实例。
            None => {
                if let Some(pid) = current_listener_pid {
                    if self.is_http_ready_on_port(current_port, "/health", false, 2000, 5000) {
                        self.set_adopted_existing_pid(Some(pid));
                        return true;
                    }
                }
                false
            }
        }
    }

    pub fn has_live_gateway_instance(&self) -> bool {
        self.is_child_alive() || self.has_live_adopted_gateway_instance()
    }

    pub fn managed_gateway_pid(&self) -> Option<u32> {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(None) => return Some(child.id()),
                Ok(Some(_)) | Err(_) => {}
            }
        }
        drop(guard);
        if self.has_live_adopted_gateway_instance() {
            return self.get_adopted_existing_pid();
        }
        None
    }

    fn candidate_existing_ports(&self) -> Vec<u16> {
        let mut ports = Vec::with_capacity((DEFAULT_PORT - MIN_PORT + 1) as usize);
        let current = self.get_port();
        ports.push(current);
        for port in (MIN_PORT..=DEFAULT_PORT).rev() {
            if port != current {
                ports.push(port);
            }
        }
        ports
    }

    /// 快速 TCP 探测：仅检查端口是否有进程在监听。
    /// 用于启动阶段批量扫描候选端口，避免对每个端口做完整 HTTP 探测。
    /// localhost 连接在有监听时是亚毫秒级的，150ms 超时足以覆盖极端情况。
    fn is_port_open(port: u16) -> bool {
        let addr = format!("127.0.0.1:{}", port);
        TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_millis(150)).is_ok()
    }

    fn adopt_existing_healthy_gateway(&self) -> Option<u16> {
        let scan_start = std::time::Instant::now();

        // 冷启动快速跳过：全新安装没有配置文件，不可能有已运行的 gateway
        let config_path = crate::utils::platform::get_config_file_path();
        if !std::path::Path::new(&config_path).exists() {
            info!("[Gateway] 全新安装（无配置文件），跳过端口扫描");
            return None;
        }

        // 优先检查上次成功的端口（重启场景下大概率命中，亚毫秒级）
        if let Some(last_port) = read_last_known_port() {
            if Self::is_port_open(last_port) {
                debug!("[Gateway] 上次端口 {} 有监听，执行 HTTP 探测", last_port);
                if self.is_http_ready_on_port(last_port, "/health", false, 2000, 5000) {
                    if let Some(pid) = resolve_port_listener_pid(last_port) {
                        if self.get_port() != last_port {
                            self.set_last_navigated_url(None);
                        }
                        self.set_port(last_port);
                        self.set_adopted_existing_pid(Some(pid));
                        self.set_adopted_existing_instance(true);
                        info!(
                            "[Gateway] 通过上次端口快速接管 gateway，端口 {}, 耗时 {:.1}s",
                            last_port,
                            scan_start.elapsed().as_secs_f64()
                        );
                        return Some(last_port);
                    }
                }
            }
        }

        // 并行 TCP 探测：Windows 上关闭端口不会立即返回 CONNREFUSED，
        // 每个探测需等满 150ms 超时。串行扫描 90 端口 ≈ 13.5s，
        // 并行后所有探测同时进行，总耗时 ≈ 150ms。
        let ports = self.candidate_existing_ports();
        let port_count = ports.len();

        let open_ports: Vec<u16> = std::thread::scope(|s| {
            let handles: Vec<_> = ports
                .iter()
                .map(|&port| s.spawn(move || if Self::is_port_open(port) { Some(port) } else { None }))
                .collect();
            handles
                .into_iter()
                .filter_map(|h| h.join().unwrap_or(None))
                .collect()
        });

        for port in open_ports {
            debug!("[Gateway] 端口 {} 有监听，执行完整 HTTP 探测", port);
            if self.is_http_ready_on_port(port, "/health", false, 2000, 5000) {
                let Some(adopted_pid) = resolve_port_listener_pid(port) else {
                    warn!(
                        "[Gateway] 发现健康 gateway，但未能识别端口 {} 的监听 PID，跳过接管",
                        port
                    );
                    continue;
                };
                if self.get_port() != port {
                    self.set_last_navigated_url(None);
                }
                self.set_port(port);
                self.set_adopted_existing_pid(Some(adopted_pid));
                self.set_adopted_existing_instance(true);
                save_last_known_port(port);
                info!(
                    "[Gateway] 发现已有健康 gateway，接管端口 {}, 耗时 {:.1}s",
                    port,
                    scan_start.elapsed().as_secs_f64()
                );
                return Some(port);
            }
        }
        let scan_elapsed = scan_start.elapsed();
        info!(
            "[Gateway] 端口扫描完成: {} 个端口, 耗时 {:.1}s, 无已有 gateway",
            port_count,
            scan_elapsed.as_secs_f64()
        );
        None
    }

    /// 设置抑制自动重启标志（手动停止或更新前调用）
    pub fn set_suppress_restart(&self, val: bool) {
        self.suppress_restart.store(val, Ordering::SeqCst);
    }

    /// 检查是否抑制自动重启
    pub fn is_restart_suppressed(&self) -> bool {
        self.suppress_restart.load(Ordering::SeqCst)
    }

    pub fn cancel_pending_waits(&self) {
        self.wait_cancel_epoch.fetch_add(1, Ordering::SeqCst);
    }

    pub fn is_startup_wait_active(&self) -> bool {
        self.startup_wait_count.load(Ordering::SeqCst) > 0
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

        drop(guard);
        if let Some(port) = self.adopt_existing_healthy_gateway() {
            let mut guard = self.child.lock().unwrap();
            *guard = None;
            self.set_startup_run_id(None);
            return Ok(port);
        }


        let startup_state_gateway_pid = read_to_string(gateway_startup_state_path())
            .ok()
            .and_then(|s| serde_json::from_str::<GatewayStartupStateRecord>(&s).ok())
            .filter(|r| r.state == "starting" && r.port == DEFAULT_PORT)
            .and_then(|r| r.pid);
        if let Some(expected_pid) = startup_state_gateway_pid {
            if check_port_listening(DEFAULT_PORT) == Some(expected_pid) {
                info!(
                    "[Gateway] 端口 {} 有 openclaw gateway 正在启动，等待就绪后接管...",
                    DEFAULT_PORT
                );
                let cancel_epoch = self.wait_cancel_epoch.load(Ordering::SeqCst);
                loop {
                    std::thread::sleep(Duration::from_millis(500));
                    if self.is_restart_suppressed()
                        || self.wait_cancel_epoch.load(Ordering::SeqCst) != cancel_epoch
                    {
                        info!("[Gateway] 等待端口 {} 就绪期间收到取消信号", DEFAULT_PORT);
                        return Err("启动已取消".to_string());
                    }
                    if let Some(port) = self.adopt_existing_healthy_gateway() {
                        let mut guard = self.child.lock().unwrap();
                        *guard = None;
                        self.set_startup_run_id(None);
                        return Ok(port);
                    }
                    if check_port_listening(DEFAULT_PORT).is_none() {
                        info!("[Gateway] 端口 {} 监听进程已退出，继续启动新进程", DEFAULT_PORT);
                        break;
                    }
                }
            }
        }
        guard = self.child.lock().unwrap();
        // 重新获取锁后再次检查：其他线程可能已启动了进程
        if let Some(ref mut child) = *guard {
            if let Ok(None) = child.try_wait() {
                info!("[Gateway] 重新获取锁后发现已有存活进程，拦截重复启动");
                return Ok(self.get_port());
            }
        }

        info!("[Gateway] 启动 gateway 进程...");

        // 查找可用端口
        let port = shell::find_available_port(DEFAULT_PORT, MIN_PORT)
            .ok_or_else(|| format!("在 {}-{} 范围内未找到可用端口", MIN_PORT, DEFAULT_PORT))?;

        if port != DEFAULT_PORT {
            info!(
                "[Gateway] 默认端口 {} 被占用，使用端口 {}",
                DEFAULT_PORT, port
            );
        }

        let startup_run_id = format!(
            "{}-{:016x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default(),
            rand::random::<u64>()
        );
        let child = shell::spawn_openclaw_gateway_with_handle(port, &startup_run_id)
            .map_err(|e| format!("启动 gateway 失败: {}", e))?;

        info!(
            "[Gateway] gateway 进程已启动, PID: {}, 端口: {}",
            child.id(),
            port
        );

        self.set_port(port);
        self.set_adopted_existing_instance(false);
        self.set_adopted_existing_pid(None);
        self.set_startup_run_id(Some(startup_run_id));
        save_last_known_port(port);
        *guard = Some(child);

        Ok(port)
    }

    /// 显式启动入口使用：
    /// 如果当前已有 gateway 实例（无论是本进程追踪的 child 还是已接管的外部实例）
    /// 但 control UI 实际不可用，直接执行一次自愈重启，而不是旁路再起一个新实例。
    pub fn start_or_recover_for_control_ui(&self) -> Result<u16, String> {
        if self.has_live_gateway_instance() {
            if self.is_ready() {
                info!("[Gateway] 已有健康的 gateway 子进程，复用当前实例");
                return Ok(self.get_port());
            }
            warn!("[Gateway] 检测到半活 gateway 实例，显式启动前先执行自愈重启");
            self.stop();
            std::thread::sleep(Duration::from_secs(1));
        }
        self.start()
    }

    /// 停止 gateway 子进程
    pub fn stop(&self) {
        info!("[Gateway] 停止 gateway 进程...");
        self.cancel_pending_waits();
        let target_port = self.get_port();
        let adopted_existing_pid = self.get_adopted_existing_pid();

        // 检查子进程是否还在运行，force kill
        let mut guard = self.child.lock().unwrap();
        let tracked_child_pid = guard.as_ref().map(std::process::Child::id);
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    info!("[Gateway] gateway 进程已退出");
                }
                Ok(None) => {
                    // 进程仍在运行，先按 PID 发送优雅停止，再必要时强制终止。
                    warn!("[Gateway] gateway 进程仍在运行，先尝试优雅停止");
                    #[cfg(target_os = "windows")]
                    {
                        use std::os::windows::process::CommandExt;
                        let _ = std::process::Command::new("taskkill")
                            .args(["/T", "/PID", &child.id().to_string()])
                            .creation_flags(0x08000000)
                            .status();
                    }
                    #[cfg(unix)]
                    {
                        let _ = std::process::Command::new("kill")
                            .args(["-TERM", &child.id().to_string()])
                            .status();
                    }
                    std::thread::sleep(Duration::from_secs(1));

                    let needs_force_kill = match child.try_wait() {
                        Ok(Some(_status)) => {
                            info!("[Gateway] gateway 进程已优雅退出");
                            false
                        }
                        Ok(None) => {
                            warn!("[Gateway] gateway 进程未响应优雅停止，强制终止");
                            true
                        }
                        Err(e) => {
                            warn!("[Gateway] 检查优雅停止结果失败: {}", e);
                            true
                        }
                    };
                    if needs_force_kill {
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
        drop(guard);

        if let Some(pid) = check_port_listening(target_port) {
            let should_kill_residual =
                tracked_child_pid == Some(pid) || adopted_existing_pid == Some(pid);
            if should_kill_residual {
                warn!(
                    "[Gateway] 端口 {} 仍被 PID {} 占用，强制终止残留 gateway 实例",
                    target_port, pid
                );
                force_kill_pid(pid);
                std::thread::sleep(Duration::from_secs(1));
            }
        }

        let mut guard = self.child.lock().unwrap();
        *guard = None;
        self.set_adopted_existing_instance(false);
        self.set_adopted_existing_pid(None);
        self.set_startup_run_id(None);
        self.set_last_navigated_url(None);
        info!("[Gateway] gateway 进程已停止");
    }

    /// 启动阶段探测：使用 /ready 端点，等待 gateway 完成全部初始化后才返回 true。
    /// /ready 在插件加载、channel 启动等全部完成后才返回 200，之前返回 503。
    pub fn is_ready(&self) -> bool {
        self.is_http_ready_on_port(self.get_port(), "/ready", true, 2000, 5000)
    }

    /// 轻量健康检查探测：用更短的超时快速判断 gateway 是否存活。
    /// 使用 /health（存活探测），只要 HTTP 栈在运行就返回 200，
    /// 不受 channel 健康状态影响，避免因单个 channel 抖动误判 gateway 崩溃。
    fn is_ready_fast(&self) -> bool {
        let port = self.get_port();
        if !Self::is_port_open(port) {
            debug!("[Gateway] is_ready_fast: 端口 {} 未监听", port);
            return false;
        }
        self.is_http_ready_on_port(port, "/health", false, 500, 1500)
    }

    /// 通用 HTTP 探测，支持可配置超时和端点。
    /// - `endpoint`: 探测路径，"/ready" 用于启动等待，"/health" 用于存活检查
    /// - `connect_timeout_ms`: TCP 连接超时
    /// - `read_timeout_ms`: HTTP 响应读取超时
    fn is_http_ready_on_port(
        &self,
        port: u16,
        endpoint: &str,
        log_failures: bool,
        connect_timeout_ms: u64,
        read_timeout_ms: u64,
    ) -> bool {
        let addr = format!("127.0.0.1:{}", port);
        let mut stream = match TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(connect_timeout_ms),
        ) {
            Ok(s) => s,
            Err(e) => {
                if log_failures {
                    // 启动阶段 TCP 连接失败是正常的，降为 debug 级别减少日志噪音
                    debug!("[Gateway] is_ready: TCP 连接失败 (端口 {}): {}", port, e);
                }
                return false;
            }
        };
        let _ = stream.set_read_timeout(Some(Duration::from_millis(read_timeout_ms)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(connect_timeout_ms)));
        // /ready 在 gateway 完成全部初始化后返回 200，之前返回 503；
        // /health 只要 HTTP 栈在运行就返回 200，不受 channel 健康状态影响。
        let request = format!(
            "GET {} HTTP/1.0\r\nHost: 127.0.0.1:{}\r\n\r\n",
            endpoint, port
        );
        if let Err(e) = stream.write_all(request.as_bytes()) {
            if log_failures {
                debug!(
                    "[Gateway] is_ready: HTTP 请求发送失败 (端口 {}): {}",
                    port, e
                );
            }
            return false;
        }
        // 读取足够的响应头来判断状态码：HTTP/1.x 200 = 就绪，503 = 初始化中
        let mut buf = [0u8; 32];
        match stream.read(&mut buf) {
            Ok(n) if n >= 12 => {
                let response = String::from_utf8_lossy(&buf[..n]);
                if !response.starts_with("HTTP/") {
                    if log_failures {
                        debug!(
                            "[Gateway] is_ready: 响应不是 HTTP (端口 {}): {:?}",
                            port, response
                        );
                    }
                    return false;
                }
                let ready = response.contains(" 200");
                if ready {
                    info!("[Gateway] is_ready: {} 返回 200 (端口 {})", endpoint, port);
                } else {
                    debug!(
                        "[Gateway] is_ready: {} 尚未就绪 (端口 {}): {:?}",
                        endpoint,
                        port,
                        &response[..std::cmp::min(n, 20)]
                    );
                }
                ready
            }
            Ok(n) => {
                if log_failures {
                    debug!("[Gateway] is_ready: 响应太短 (端口 {}, {} bytes)", port, n);
                }
                false
            }
            Err(e) => {
                if log_failures {
                    debug!("[Gateway] is_ready: 读取响应失败 (端口 {}): {}", port, e);
                }
                false
            }
        }
    }

    /// 轮询等待 gateway 就绪。
    /// 持续探测 /ready 端点直到返回 200（即 gateway 完成全部初始化：插件加载、
    /// channel 启动等），WebView 在此之前保持 splash 画面。
    /// 仅在 gateway 进程明确退出失败，或等待被取消时返回。
    fn wait_for_ready_inner(&self, wait_cancel_epoch: u64) -> WaitForReadyOutcome {
        // 启动等待阶段：200ms 对低性能电脑友好，又不至于像 500ms 那样显著拖慢启动体验。
        // 对比：50ms (v0.3.1) 过于频繁 → 200ms 折中 → 500ms (前版) 太慢。
        let http_poll_interval = Duration::from_millis(200);
        let started_at = std::time::Instant::now();
        let mut last_child_check = std::time::Instant::now();
        let mut last_startup_state_check = std::time::Instant::now();

        loop {
            let now = std::time::Instant::now();

            if self.wait_cancel_epoch.load(Ordering::SeqCst) != wait_cancel_epoch {
                info!("[Gateway] 启动等待已取消");
                return WaitForReadyOutcome::Canceled;
            }

            if last_startup_state_check.elapsed() >= Duration::from_millis(250) {
                last_startup_state_check = std::time::Instant::now();
                if let Some(reason) = self.current_startup_failure() {
                    warn!("[Gateway] gateway 显式报告启动失败: {}", reason);
                    return WaitForReadyOutcome::Failed(reason);
                }
            }

            // 单阶段探测：HTTP 响应即代表 gateway 完全就绪
            if self.is_ready() {
                let elapsed = now.duration_since(started_at);
                info!("[Gateway] gateway 已就绪 ({:.1}秒)", elapsed.as_secs_f64());
                self.mark_ready();
                return WaitForReadyOutcome::Ready;
            }

            // 每秒检查一次子进程是否意外退出（不必每次 poll 都检查）
            if last_child_check.elapsed() >= Duration::from_secs(1) {
                last_child_check = std::time::Instant::now();
                let mut guard = self.child.lock().unwrap();
                if let Some(ref mut child) = *guard {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            let reason = read_recent_gateway_start_failure().unwrap_or_else(|| {
                                format!("Gateway 进程意外退出 (退出码: {:?})", status.code())
                            });
                            error!(
                                "[Gateway] gateway 进程意外退出, 退出码: {:?}, 原因: {}",
                                status.code(),
                                reason
                            );
                            return WaitForReadyOutcome::Failed(reason);
                        }
                        Ok(None) => {} // 仍在运行
                        Err(e) => {
                            warn!("[Gateway] 检查进程状态失败: {}", e);
                        }
                    }
                } else {
                    let outcome = if self.adopted_existing_instance.load(Ordering::SeqCst) {
                        if self.has_live_adopted_gateway_instance() {
                            None // still alive, continue
                        } else {
                            self.set_adopted_existing_instance(false);
                            self.set_adopted_existing_pid(None);
                            warn!("[Gateway] 接管的已有 gateway 在就绪确认前消失，转为失败并触发自愈");
                            Some(WaitForReadyOutcome::Failed(
                                "接管的已有 Gateway 在就绪确认前已退出".to_string(),
                            ))
                        }
                    } else {
                        info!("[Gateway] 已无追踪中的 gateway 子进程，结束启动等待");
                        Some(WaitForReadyOutcome::Canceled)
                    };
                    drop(guard);
                    match outcome {
                        Some(o) => return o,
                        None => continue,
                    }
                }
            }

            std::thread::sleep(http_poll_interval);
        }
    }

    fn wait_for_ready_until_failure(&self, wait_cancel_epoch: u64) -> WaitForReadyOutcome {
        self.wait_for_ready_inner(wait_cancel_epoch)
    }

    /// 启动或重启入口使用：
    /// 持续等待直到 gateway 就绪；若进程明确启动失败，则立即自愈重启一次后继续等待。
    pub fn wait_for_ready_or_recover_once(&self) -> GatewayWaitOutcome {
        let wait_cancel_epoch = self.wait_cancel_epoch.load(Ordering::SeqCst);
        let _startup_wait = StartupWaitGuard::new(self);

        match self.wait_for_ready_until_failure(wait_cancel_epoch) {
            WaitForReadyOutcome::Ready => {
                self.set_startup_run_id(None);
                GatewayWaitOutcome::Ready(self.get_port())
            }
            WaitForReadyOutcome::Canceled => {
                self.set_startup_run_id(None);
                GatewayWaitOutcome::Canceled
            }
            WaitForReadyOutcome::Failed(reason) => {
                self.set_startup_run_id(None);
                if let Some(port) = self.adopt_existing_healthy_gateway() {
                    info!(
                        "[Gateway] 启动失败后发现已有健康 gateway，改为接管现有实例 (端口: {})",
                        port
                    );
                    return GatewayWaitOutcome::Ready(port);
                }
                warn!(
                    "[Gateway] 检测到明确启动失败，立即尝试一次同步自愈重启: {}",
                    reason
                );
                let recovered_port = match self.start_or_recover_for_control_ui() {
                    Ok(port) => port,
                    Err(e) => {
                        return GatewayWaitOutcome::Failed(format!("Gateway 自愈重启失败: {}", e))
                    }
                };
                // 自愈重启路径里可能先 stop() 再拉起新进程；stop() 会推进 cancel epoch。
                // 第二轮等待必须读取新的 epoch，避免把内部重启误判成外部取消。
                let recovery_wait_cancel_epoch = self.wait_cancel_epoch.load(Ordering::SeqCst);

                match self.wait_for_ready_until_failure(recovery_wait_cancel_epoch) {
                    WaitForReadyOutcome::Ready => {
                        self.set_startup_run_id(None);
                        GatewayWaitOutcome::Ready(recovered_port)
                    }
                    WaitForReadyOutcome::Canceled => {
                        self.set_startup_run_id(None);
                        GatewayWaitOutcome::Canceled
                    }
                    WaitForReadyOutcome::Failed(reason) => {
                        self.set_startup_run_id(None);
                        GatewayWaitOutcome::Failed(reason)
                    }
                }
            }
        }
    }

    /// 检查子进程是否仍在运行
    pub fn is_child_alive(&self) -> bool {
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

fn gateway_stderr_log_path() -> PathBuf {
    PathBuf::from(crate::utils::platform::get_config_dir())
        .join("logs")
        .join("gateway.stderr.log")
}

fn gateway_startup_state_path() -> PathBuf {
    PathBuf::from(crate::utils::platform::get_config_dir()).join("gateway-startup-state.json")
}

fn last_known_port_path() -> PathBuf {
    PathBuf::from(crate::utils::platform::get_config_dir()).join("last-gateway-port")
}

fn read_last_known_port() -> Option<u16> {
    std::fs::read_to_string(last_known_port_path())
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .filter(|&p: &u16| p >= MIN_PORT && p <= DEFAULT_PORT)
}

fn save_last_known_port(port: u16) {
    let _ = std::fs::write(last_known_port_path(), port.to_string());
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayStartupStateRecord {
    run_id: String,
    pid: Option<u32>,
    port: u16,
    state: String,
    phase: Option<String>,
    error: Option<String>,
}

fn read_gateway_startup_failure(run_id: &str, port: u16) -> Option<String> {
    read_gateway_startup_failure_from_path(&gateway_startup_state_path(), run_id, port)
}

fn read_gateway_startup_failure_from_path(
    path: &std::path::Path,
    run_id: &str,
    port: u16,
) -> Option<String> {
    let content = read_to_string(path).ok()?;
    let record: GatewayStartupStateRecord = serde_json::from_str(&content).ok()?;
    if record.run_id != run_id || record.port != port || record.state != "failed" {
        return None;
    }
    record.error.or(record.phase).or(Some(
        "Gateway 显式报告启动失败，但未提供错误详情".to_string(),
    ))
}

fn read_recent_gateway_start_failure() -> Option<String> {
    let content = read_to_string(gateway_stderr_log_path()).ok()?;
    let start = content
        .rfind("\n--- gateway start ")
        .map_or(0, |idx| idx + 1);
    let section = &content[start..];
    let lines: Vec<&str> = section
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("--- gateway start "))
        .collect();

    if lines.is_empty() {
        return None;
    }

    if let Some(config_invalid_idx) = lines.iter().position(|line| *line == "Config invalid") {
        let mut summary = vec!["Config invalid".to_string()];
        for line in &lines[(config_invalid_idx + 1)..] {
            if line.starts_with("Run: ") {
                break;
            }
            summary.push((*line).to_string());
        }
        return Some(summary.join("; "));
    }

    lines.last().map(|line| (*line).to_string())
}

fn check_port_listening(port: u16) -> Option<u32> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("lsof")
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
        use std::os::windows::process::CommandExt;

        let mut cmd = std::process::Command::new("netstat");
        cmd.args(["-ano"]);
        cmd.creation_flags(0x08000000);

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

fn resolve_port_listener_pid(port: u16) -> Option<u32> {
    for _ in 0..10 {
        if let Some(pid) = check_port_listening(port) {
            return Some(pid);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    None
}

fn force_kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .status();
    }

    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}

#[cfg(test)]
fn websocket_upgrade_response_ready(response: &str) -> bool {
    response
        .lines()
        .next()
        .and_then(|status_line| status_line.split_whitespace().nth(1))
        == Some("101")
}

enum WaitForReadyOutcome {
    Ready,
    Failed(String),
    Canceled,
}

pub enum GatewayWaitOutcome {
    Ready(u16),
    Failed(String),
    Canceled,
}

struct StartupWaitGuard<'a> {
    manager: &'a GatewayManager,
}

impl<'a> StartupWaitGuard<'a> {
    fn new(manager: &'a GatewayManager) -> Self {
        manager.startup_wait_count.fetch_add(1, Ordering::SeqCst);
        Self { manager }
    }
}

impl Drop for StartupWaitGuard<'_> {
    fn drop(&mut self) {
        self.manager
            .startup_wait_count
            .fetch_sub(1, Ordering::SeqCst);
    }
}

/// 发送系统桌面通知
fn send_notification(handle: &AppHandle, body: &str) {
    let _ = handle
        .notification()
        .builder()
        .title("OpenClaw桌面版")
        .body(body)
        .show();
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
/// 只有 control UI 握手可用才视为健康；连续多轮不健康后自动重启，
/// 即使子进程仍然存活也会尝试自愈半活状态。
/// 宽松参数设计：考虑低性能电脑上 Node.js gateway 启动/GC 时可能暂时无响应。
///
/// 优化策略：
/// - 使用 is_ready_fast()（最多 2s）替代 is_ready()（最多 7s）
/// - gateway 首次就绪后 30 秒内仍做 HTTP 探测，但失败不计入重启阈值
/// - 子进程存活时缩短重试间隔（5s）快速恢复
pub fn health_check_loop(handle: &AppHandle) {
    let check_interval = Duration::from_secs(10);
    let max_consecutive_failures = 6;
    let backoff_interval = Duration::from_secs(60);
    // 子进程存活但 HTTP 暂时不通时，用更短的间隔快速重试
    let child_alive_retry_interval = Duration::from_secs(5);
    // gateway 首次就绪后的宽限期（毫秒），期间探测失败不计入重启阈值
    let post_ready_grace_ms: u64 = 30_000;
    let mut consecutive_failures: u32 = 0;

    loop {
        let wait = if consecutive_failures >= max_consecutive_failures {
            backoff_interval
        } else {
            check_interval
        };
        std::thread::sleep(wait);

        let gm = handle.state::<GatewayManager>();

        // 启动等待或初始启动期间，跳过所有探测和导航。
        // /health 在 HTTP 监听后立即返回 200，但 wait_for_ready_inner 仍在等
        // /ready（完全初始化），若此处不拦截，健康检查会提前导航到未就绪的 gateway。
        if gm.is_initial_startup_in_progress() {
            debug!("[Gateway] 初始启动准备中，跳过健康检查");
            continue;
        }
        if gm.is_startup_wait_active() {
            debug!("[Gateway] 启动等待仍在进行中，跳过健康检查");
            continue;
        }

        // Post-ready 宽限期检测：gateway 刚完成启动后 30s 内，
        // 探测仍正常执行（成功可立即确认），但失败不计入重启阈值，
        // 避免初始化期间的短暂无响应被误判为崩溃。
        let in_grace_period = gm
            .ms_since_last_ready()
            .map(|ms| ms < post_ready_grace_ms)
            .unwrap_or(false);

        // 使用轻量探测（最多 2s）替代完整探测（最多 7s）
        let http_ready = gm.is_ready_fast();

        if http_ready {
            gm.mark_ready();
            consecutive_failures = 0;
            update_tray_status(handle, true);
            // 检查是否需要导航（如果之前未导航过，或目标 URL 已变化）
            let current_port = gm.get_port();
            let expected_url = crate::build_gateway_url(
                "127.0.0.1",
                current_port,
                crate::current_session_gateway_token().as_deref(),
            );

            if gm.get_last_navigated_url().as_deref() != Some(expected_url.as_str()) {
                info!("[Gateway] 健康检查确认 control UI 已就绪且目标 URL 需更新，执行导航");
                navigate_webview_to_gateway(handle, current_port);
            }
            continue; // 正常运行
        }

        // Post-ready 宽限期内：探测失败不计入重启阈值，仅记录日志。
        // 这样 gateway 有时间完成初始化，同时探测成功时可立即确认。
        if in_grace_period {
            debug!(
                "[Gateway] post-ready 宽限期内，探测失败不计入重启 ({}ms / {}ms)",
                gm.ms_since_last_ready().unwrap_or(0),
                post_ready_grace_ms
            );
            continue;
        }

        let child_alive = gm.has_live_gateway_instance();
        if child_alive {
            // 子进程仍在运行但 HTTP 探测失败，可能是 gateway 暂时繁忙；
            // 不计失败、不更新托盘状态，用更短间隔快速重试。
            info!("[Gateway] 子进程仍在运行，HTTP 探测暂时失败，{}秒后快速重试",
                child_alive_retry_interval.as_secs());
            std::thread::sleep(child_alive_retry_interval);
            // 快速重试一次
            if gm.is_ready_fast() {
                gm.mark_ready();
                info!("[Gateway] 快速重试成功，gateway 已恢复");
                consecutive_failures = 0;
                update_tray_status(handle, true);
            }
            continue;
        }

        // 子进程已退出且 HTTP 不可达，更新托盘为"已停止"
        update_tray_status(handle, false);

        consecutive_failures += 1;
        warn!(
            "[Gateway] 健康检查：gateway 未响应 (连续失败 {}次)",
            consecutive_failures
        );

        if consecutive_failures < max_consecutive_failures {
            info!("[Gateway] 子进程已退出，等待达到重试阈值后自动重启");
            continue;
        }

        // 更新期间不自动重启，避免与安装程序冲突
        if gm.is_restart_suppressed() {
            info!("[Gateway] 自动重启已抑制（更新中），跳过");
            continue;
        }

        warn!("[Gateway] 子进程已退出，尝试自动重启...");
        let _ = handle.emit("gateway-status", "Gateway 已断开，正在重启...");
        if let Err(e) = crate::commands::config::ensure_channel_plugins_enabled() {
            warn!("[Gateway] 自动重启前配置修复失败: {}", e);
        }
        if let Err(e) = crate::commands::config::ensure_gateway_token() {
            consecutive_failures += 1;
            error!(
                "[Gateway] 自动重启前初始化 gateway token 失败 (连续失败 {}次): {}",
                consecutive_failures, e
            );
            let msg = format!("Gateway token 初始化失败: {}", e);
            let _ = handle.emit("gateway-status", msg.as_str());
            update_tray_status(handle, false);
            continue;
        }

        match gm.start_or_recover_for_control_ui() {
            Ok(_port) => {
                let _ = handle.emit("gateway-status", "正在等待 Gateway 重启...");
                let restart_handle = handle.clone();
                std::thread::spawn(move || {
                    let gm = restart_handle.state::<GatewayManager>();
                    match gm.wait_for_ready_or_recover_once() {
                        GatewayWaitOutcome::Ready(ready_port) => {
                            info!("[Gateway] 自动重启成功，端口: {}", ready_port);
                            update_tray_status(&restart_handle, true);
                            send_notification(
                                &restart_handle,
                                &format!("Gateway 已自动重启 (端口 {})", ready_port),
                            );
                            navigate_webview_to_gateway(&restart_handle, ready_port);
                        }
                        GatewayWaitOutcome::Canceled => {
                            info!("[Gateway] 自动重启等待已取消");
                        }
                        GatewayWaitOutcome::Failed(reason) => {
                            error!("[Gateway] 自动重启失败: {}", reason);
                            let msg = format!("Gateway 启动失败: {}", reason);
                            let _ = restart_handle.emit("gateway-status", msg.as_str());
                            update_tray_status(&restart_handle, false);
                        }
                    }
                });
            }
            Err(e) => {
                consecutive_failures += 1;
                error!(
                    "[Gateway] 自动重启失败 (连续失败 {}次): {}",
                    consecutive_failures, e
                );
                update_tray_status(handle, false);
                if consecutive_failures >= max_consecutive_failures {
                    let _ = handle.emit("gateway-status", "Gateway 启动失败，已进入低频重试模式");
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
    let url = crate::build_gateway_url(
        "127.0.0.1",
        port,
        crate::current_session_gateway_token().as_deref(),
    );

    if gm.get_last_navigated_url().as_deref() == Some(url.as_str()) {
        info!(
            "[Gateway] navigate_webview_to_gateway: 防抖跳过 (url={})",
            url
        );
        return;
    }

    info!("[Gateway] navigate_webview_to_gateway: 导航到 {}", url);
    let _ = handle.emit("gateway-ready", url.as_str());

    // 使用 JavaScript 执行导航，因为 window.navigate() 在某些情况下不生效
    if let Some(window) = handle.get_webview_window("main") {
        // 使用 JSON 序列化确保 URL 字符串安全转义
        let url_json = match serde_json::to_string(&url) {
            Ok(json) => json,
            Err(e) => {
                error!("[Gateway] URL JSON 序列化失败: {}", e);
                return;
            }
        };
        let js = format!("window.location.href = {};", url_json);
        match window.eval(&js) {
            Ok(_) => {
                info!("[Gateway] navigate_webview_to_gateway: JS 导航已执行");
                gm.set_last_navigated_url(Some(url));
            }
            Err(e) => error!("[Gateway] navigate_webview_to_gateway: JS 导航失败: {}", e),
        }
    } else {
        error!("[Gateway] navigate_webview_to_gateway: 找不到 main 窗口");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        read_gateway_startup_failure_from_path, websocket_upgrade_response_ready, GatewayManager,
        WaitForReadyOutcome, DEFAULT_PORT, MIN_PORT,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;

    #[test]
    fn accepts_websocket_upgrade_ready_response() {
        assert!(websocket_upgrade_response_ready(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n"
        ));
    }

    #[test]
    fn rejects_non_upgrade_response() {
        assert!(!websocket_upgrade_response_ready(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n"
        ));
        assert!(!websocket_upgrade_response_ready("not-http"));
    }

    #[test]
    fn candidate_existing_ports_cover_full_fallback_range() {
        let current = DEFAULT_PORT - 5;
        let gm = GatewayManager::new(current);
        let ports = gm.candidate_existing_ports();

        assert_eq!(ports.first().copied(), Some(current));
        assert!(ports.contains(&DEFAULT_PORT));
        assert!(ports.contains(&MIN_PORT));
        assert_eq!(ports.len(), (DEFAULT_PORT - MIN_PORT + 1) as usize);
    }

    #[test]
    fn adopted_instance_disappearing_before_ready_is_treated_as_failure() {
        let gm = GatewayManager::new(DEFAULT_PORT);
        gm.adopted_existing_instance.store(true, Ordering::SeqCst);

        let outcome = gm.wait_for_ready_inner(0);

        match outcome {
            WaitForReadyOutcome::Failed(reason) => {
                assert!(reason.contains("接管的已有 Gateway"));
            }
            WaitForReadyOutcome::Ready => panic!("expected failure, got ready"),
            WaitForReadyOutcome::Canceled => panic!("expected failure, got canceled"),
        }
    }

    #[test]
    fn adopted_instance_counts_as_live_when_recorded_pid_still_owns_port() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let gm = GatewayManager::new(port);
        gm.adopted_existing_instance.store(true, Ordering::SeqCst);
        gm.set_adopted_existing_pid(super::check_port_listening(port));

        assert!(gm.has_live_gateway_instance());
    }

    #[test]
    fn adopted_instance_is_not_live_when_recorded_pid_no_longer_owns_port() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let gm = GatewayManager::new(port);
        gm.adopted_existing_instance.store(true, Ordering::SeqCst);
        gm.set_adopted_existing_pid(super::check_port_listening(port));
        drop(listener);

        assert!(!gm.has_live_gateway_instance());
    }

    #[test]
    fn reads_matching_explicit_startup_failure() {
        let path = unique_temp_file("gateway-startup-state");
        fs::write(
            &path,
            r#"{"runId":"desktop-run-1","port":28789,"state":"failed","phase":"starting HTTP server","error":"canvas bootstrap failed"}"#,
        )
        .unwrap();

        let failure = read_gateway_startup_failure_from_path(&path, "desktop-run-1", 28789);

        assert_eq!(failure.as_deref(), Some("canvas bootstrap failed"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn ignores_stale_startup_failure_for_other_run() {
        let path = unique_temp_file("gateway-startup-state");
        fs::write(
            &path,
            r#"{"runId":"desktop-run-old","port":28789,"state":"failed","error":"stale failure"}"#,
        )
        .unwrap();

        let failure = read_gateway_startup_failure_from_path(&path, "desktop-run-new", 28789);

        assert!(failure.is_none());
        let _ = fs::remove_file(path);
    }

    fn unique_temp_file(prefix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "{}-{}-{}.json",
            prefix,
            std::process::id(),
            rand::random::<u64>()
        ))
    }
}
