use log::{debug, error, info, warn};
use std::fs;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::utils::{platform, shell};

pub struct ClawPanelManager {
    child: Mutex<Option<Child>>,
    port: u16,
}

impl ClawPanelManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: 19527,
        }
    }

    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        let mut child_guard = self.child.lock().unwrap();
        if child_guard.is_some() {
            return Ok(());
        }

        let binary_path = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?
            .join("clawpanel-x86_64-pc-windows-msvc.exe");

        info!("Starting ClawPanel at: {:?}", binary_path);

        // 传递环境变量让 ClawPanel 能正确找到 OpenClaw 配置和运行时
        let openclaw_dir = platform::get_config_dir(); // ~/.openclawcn
        let openclaw_app = std::env::var("OPENCLAW_GATEWAY_BUNDLE_DIR").unwrap_or_default();
        let gateway_port = crate::gateway::GLOBAL_GATEWAY_PORT
            .load(std::sync::atomic::Ordering::SeqCst);

        // 将 Node.js 所在目录加入 PATH，使 ClawPanel 能找到 node 来运行 openclaw.mjs
        let mut extended_path = std::env::var("PATH").unwrap_or_default();
        if let Some(node_path) = shell::get_node_path() {
            if let Some(parent) = Path::new(&node_path).parent() {
                let sep = if cfg!(windows) { ";" } else { ":" };
                extended_path = format!("{}{}{}", parent.to_string_lossy(), sep, extended_path);
            }
        }

        info!(
            "ClawPanel env: OPENCLAW_DIR={}, OPENCLAW_APP={}, gateway_port={}",
            openclaw_dir, openclaw_app, gateway_port
        );

        // Redirect ClawPanel stdout/stderr to log files for crash diagnosis
        let log_dir = platform::get_config_dir(); // ~/.openclawcn
        let log_base = Path::new(&log_dir).join("logs");
        let _ = fs::create_dir_all(&log_base);
        let stdout_path = log_base.join("clawpanel-stdout.log");
        let stderr_path = log_base.join("clawpanel-stderr.log");
        info!(
            "ClawPanel logs: stdout={}, stderr={}",
            stdout_path.display(),
            stderr_path.display()
        );

        let stdout_file = fs::File::create(&stdout_path)
            .map_err(|e| format!("Failed to create ClawPanel stdout log: {}", e))?;
        let stderr_file = fs::File::create(&stderr_path)
            .map_err(|e| format!("Failed to create ClawPanel stderr log: {}", e))?;

        let child = Command::new(&binary_path)
            .env("CLAWPANEL_PORT", self.port.to_string())
            .env("OPENCLAW_DIR", &openclaw_dir)
            .env("OPENCLAW_APP", &openclaw_app)
            .env("OPENCLAW_DESKTOP", "1")
            .env("OPENCLAW_GATEWAY_PORT", gateway_port.to_string())
            .env("PATH", &extended_path)
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()
            .map_err(|e| format!("Failed to spawn ClawPanel: {}", e))?;

        *child_guard = Some(child);
        info!("ClawPanel started on port {}", self.port);
        Ok(())
    }

    pub fn stop(&self) {
        let mut child_guard = self.child.lock().unwrap();
        if let Some(mut child) = child_guard.take() {
            debug!("Stopping ClawPanel process");
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for ClawPanelManager {
    fn drop(&mut self) {
        self.stop();
    }
}
