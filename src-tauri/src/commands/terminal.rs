use std::collections::HashMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Mutex;
use log::{info, warn, debug};
use tauri::{command, AppHandle, Emitter, Manager};
use portable_pty::{CommandBuilder, PtySize, native_pty_system, MasterPty};

#[cfg(not(target_os = "windows"))]
use std::os::unix::fs::PermissionsExt;

/// 终端会话（基于 PTY）
struct TerminalSession {
    writer: Box<dyn IoWrite + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// 全局终端状态管理
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    next_id: Mutex<u32>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: Mutex::new(1),
        }
    }
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (id, session) in sessions.iter_mut() {
            info!("[Terminal] 清理终端会话: {}", id);
            let _ = session.child.kill();
        }
        sessions.clear();
    }
}

/// 获取 shell 命令和参数（跨平台）
fn get_shell() -> (&'static str, Vec<&'static str>) {
    #[cfg(target_os = "windows")]
    {
        ("powershell.exe", vec!["-NoLogo"])
    }
    #[cfg(not(target_os = "windows"))]
    {
        ("bash", vec!["--login"])
    }
}

/// 从 PTY master 持续读取并通过 Tauri 事件发送到前端
fn spawn_reader_thread(
    app: AppHandle,
    id: String,
    mut reader: Box<dyn IoRead + Send>,
) {
    std::thread::spawn(move || {
        debug!("[Terminal] reader 线程启动: {}", id);
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    debug!("[Terminal] reader EOF: {}", id);
                    break;
                }
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]);
                    let payload = serde_json::json!({
                        "id": id,
                        "data": text,
                    });
                    if let Err(e) = app.emit("terminal-output", payload) {
                        warn!("[Terminal] emit 失败: {} - {}", id, e);
                    }
                }
                Err(e) => {
                    warn!("[Terminal] reader 错误: {} - {}", id, e);
                    break;
                }
            }
        }
        debug!("[Terminal] reader 线程退出: {}", id);
    });
}

/// 创建终端会话（使用 PTY），返回会话 ID
#[command]
pub async fn terminal_create(app: AppHandle, cols: Option<u16>, rows: Option<u16>) -> Result<String, String> {
    let state = app.state::<TerminalState>();

    let id = {
        let mut next = state.next_id.lock().unwrap();
        let id = format!("term-{}", *next);
        *next += 1;
        id
    };

    let actual_cols = cols.unwrap_or(80);
    let actual_rows = rows.unwrap_or(24);

    let (shell, args) = get_shell();
    info!("[Terminal] 创建终端会话 {}: {} {:?} ({}x{})", id, shell, args, actual_cols, actual_rows);

    // 打开 PTY
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: actual_rows,
        cols: actual_cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| format!("打开 PTY 失败: {}", e))?;

    let mut cmd = CommandBuilder::new(shell);
    for arg in &args {
        cmd.arg(*arg);
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("FORCE_COLOR", "1");
    cmd.env("COLUMNS", actual_cols.to_string());
    cmd.env("LINES", actual_rows.to_string());

    // 设置 PATH，确保内置 node 和 openclaw 可用
    let mut path_parts: Vec<String> = Vec::new();

    let wrapper_dir = std::env::temp_dir().join("openclaw-terminal");
    let _ = std::fs::create_dir_all(&wrapper_dir);

    if let Ok(bundle_dir) = std::env::var("OPENCLAW_GATEWAY_BUNDLE_DIR") {
        // 始终设置工作目录为 bundle 目录
        cmd.cwd(std::path::PathBuf::from(&bundle_dir));

        if let Some(node_path) = crate::utils::shell::get_node_path() {
            if let Some(node_dir) = std::path::Path::new(&node_path).parent() {
                path_parts.push(node_dir.display().to_string());
            }

            let entry_point = crate::utils::shell::get_bundle_entry()
                .map(|(_, entry)| entry);

            if let Some(entry) = entry_point {
                #[cfg(target_os = "windows")]
                {
                    let bat_path = wrapper_dir.join("openclaw.cmd");
                    let bat_content = format!("@echo off\r\n\"{}\" \"{}\" %*\r\n", node_path, entry);
                    let _ = std::fs::write(&bat_path, bat_content);
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let sh_path = wrapper_dir.join("openclaw");
                    let sh_content = format!("#!/bin/sh\nexec \"{}\" \"{}\" \"$@\"\n", node_path, entry);
                    let _ = std::fs::write(&sh_path, &sh_content);
                    let _ = std::fs::set_permissions(&sh_path, std::fs::Permissions::from_mode(0o755));
                }
            }
        }
        path_parts.push(bundle_dir);
    } else {
        // 无 bundle 目录时，使用用户主目录
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }
    }

    path_parts.insert(0, wrapper_dir.display().to_string());

    // npm 全局安装前缀 → ~/.openclawcn/npm-global（持久化，不受应用更新影响）
    if let Some(prefix) = crate::utils::shell::get_npm_global_prefix() {
        let _ = std::fs::create_dir_all(&prefix);
        cmd.env("NPM_CONFIG_PREFIX", prefix.to_string_lossy().to_string());
        if let Some(bin_dir) = crate::utils::shell::get_npm_global_bin_dir() {
            path_parts.insert(0, bin_dir);
        }
    }

    let current_path = std::env::var("PATH").unwrap_or_default();
    path_parts.push(current_path);

    #[cfg(target_os = "windows")]
    let new_path = path_parts.join(";");
    #[cfg(not(target_os = "windows"))]
    let new_path = path_parts.join(":");

    cmd.env("PATH", new_path);

    // 传递 gateway token 和配置目录
    let token = crate::utils::shell::session_gateway_token();
    cmd.env("OPENCLAW_GATEWAY_TOKEN", token);
    cmd.env("OPENCLAW_GATEWAY_PORT", "28789");
    cmd.env("OPENCLAW_DESKTOP", "1");
    cmd.env("OPENCLAW_DESKTOP_TERMINAL", "1");
    cmd.env("OPENCLAW_STATE_DIR", crate::utils::platform::get_config_dir());

    // 在 slave 端启动子进程
    let child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("启动终端失败: {}", e))?;

    // 释放 slave — 只通过 master 交互
    drop(pair.slave);

    // 从 master 克隆 reader 和 writer
    let reader = pair.master.try_clone_reader()
        .map_err(|e| format!("获取 PTY reader 失败: {}", e))?;
    let writer = pair.master.take_writer()
        .map_err(|e| format!("获取 PTY writer 失败: {}", e))?;

    // 启动读取线程
    spawn_reader_thread(app.clone(), id.clone(), reader);

    // 先将会话插入 state，避免退出检测线程启动时找不到会话
    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(id.clone(), TerminalSession {
            writer,
            master: pair.master,
            child,
        });
    }

    // 启动退出检测线程（会话已存在于 state 中）
    let app_exit = app.clone();
    let id_exit = id.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let state = app_exit.state::<TerminalState>();
            let mut sessions = state.sessions.lock().unwrap();
            if let Some(session) = sessions.get_mut(&id_exit) {
                match session.child.try_wait() {
                    Ok(Some(_status)) => {
                        info!("[Terminal] 进程已退出: {}", id_exit);
                        // 从 sessions 中移除已退出的会话
                        let mut removed = sessions.remove(&id_exit);
                        drop(sessions); // 释放锁后再 emit
                        if let Some(ref mut s) = removed {
                            let _ = s.child.wait();
                        }
                        let payload = serde_json::json!({
                            "id": id_exit,
                            "data": "\r\n[进程已退出]\r\n",
                        });
                        let _ = app_exit.emit("terminal-output", payload);
                        let _ = app_exit.emit("terminal-exit", serde_json::json!({ "id": id_exit }));
                        break;
                    }
                    Ok(None) => {} // 仍在运行
                    Err(_) => break,
                }
            } else {
                break; // 会话已被销毁
            }
        }
    });

    info!("[Terminal] 终端会话 {} 已创建", id);
    Ok(id)
}

/// 向终端发送输入
#[command]
pub async fn terminal_write(app: AppHandle, id: String, data: String) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut sessions = state.sessions.lock().unwrap();

    if let Some(session) = sessions.get_mut(&id) {
        session.writer.write_all(data.as_bytes())
            .map_err(|e| format!("写入终端失败: {}", e))?;
        session.writer.flush()
            .map_err(|e| format!("刷新终端失败: {}", e))?;
        Ok(())
    } else {
        Err(format!("终端会话 {} 不存在", id))
    }
}

/// 调整终端大小
#[command]
pub async fn terminal_resize(app: AppHandle, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let sessions = state.sessions.lock().unwrap();

    if let Some(session) = sessions.get(&id) {
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| format!("调整终端大小失败: {}", e))?;
        Ok(())
    } else {
        Err(format!("终端会话 {} 不存在", id))
    }
}

/// 关闭终端会话
#[command]
pub async fn terminal_destroy(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<TerminalState>();
    let mut sessions = state.sessions.lock().unwrap();

    if let Some(mut session) = sessions.remove(&id) {
        info!("[Terminal] 销毁终端会话: {}", id);
        let _ = session.child.kill();
        let _ = session.child.wait();
        Ok(())
    } else {
        warn!("[Terminal] 终端会话 {} 不存在", id);
        Ok(())
    }
}
