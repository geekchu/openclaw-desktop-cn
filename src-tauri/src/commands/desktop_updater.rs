use log::info;
use serde::Serialize;
use std::sync::{Mutex, MutexGuard};
use tauri::{command, ipc::Channel, AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct DesktopUpdateState {
    session: Mutex<DesktopUpdateSession>,
}

#[derive(Default)]
struct DesktopUpdateSession {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateMetadata {
    pub version: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DesktopDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

fn lock_session<'a>(
    state: &'a DesktopUpdateState,
) -> Result<MutexGuard<'a, DesktopUpdateSession>, String> {
    state
        .session
        .lock()
        .map_err(|_| "更新状态已损坏，请重启应用后重试".to_string())
}

#[command]
pub async fn desktop_check_for_update(app: AppHandle) -> Result<Option<DesktopUpdateMetadata>, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("初始化更新器失败: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;

    let metadata = update.as_ref().map(|update| DesktopUpdateMetadata {
        version: update.version.clone(),
        body: update.body.clone(),
    });

    let state = app.state::<DesktopUpdateState>();
    let mut session = lock_session(&state)?;
    session.update = update;
    session.bytes = None;

    Ok(metadata)
}

#[command]
pub async fn desktop_download_update(
    app: AppHandle,
    on_event: Channel<DesktopDownloadEvent>,
) -> Result<(), String> {
    let update = {
        let state = app.state::<DesktopUpdateState>();
        let session = lock_session(&state)?;
        session
            .update
            .clone()
            .ok_or_else(|| "更新信息缺失，请重新检查更新".to_string())?
    };

    let mut first_chunk = true;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(DesktopDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DesktopDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DesktopDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("下载更新失败: {e}"))?;

    let state = app.state::<DesktopUpdateState>();
    let mut session = lock_session(&state)?;
    session.bytes = Some(bytes);

    Ok(())
}

#[command]
pub async fn desktop_install_update(app: AppHandle) -> Result<(), String> {
    let (update, bytes) = {
        let state = app.state::<DesktopUpdateState>();
        let session = lock_session(&state)?;
        let update = session
            .update
            .clone()
            .ok_or_else(|| "更新信息缺失，请重新检查更新".to_string())?;
        let bytes = session
            .bytes
            .clone()
            .ok_or_else(|| "更新包尚未下载完成，请先下载更新".to_string())?;
        (update, bytes)
    };

    #[cfg(windows)]
    install_windows_update(&app, &update, &bytes)?;

    #[cfg(not(windows))]
    {
        update
            .install(&bytes)
            .map_err(|e| format!("安装更新失败: {e}"))?;

        let state = app.state::<DesktopUpdateState>();
        let mut session = lock_session(&state)?;
        session.bytes = None;
    }

    Ok(())
}

#[command]
pub async fn desktop_clear_pending_update(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DesktopUpdateState>();
    let mut session = lock_session(&state)?;
    session.update = None;
    session.bytes = None;
    Ok(())
}

#[command]
pub async fn desktop_clear_downloaded_update(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DesktopUpdateState>();
    let mut session = lock_session(&state)?;
    session.bytes = None;
    Ok(())
}

#[cfg(windows)]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
#[derive(Copy, Clone)]
enum WindowsInstallerKind {
    Nsis,
    Msi,
}

#[cfg(windows)]
#[derive(Copy, Clone, Default)]
enum WindowsInstallMode {
    BasicUi,
    Quiet,
    #[default]
    Passive,
}

#[cfg(windows)]
impl WindowsInstallMode {
    fn nsis_args(self) -> &'static [&'static str] {
        match self {
            Self::Passive => &["/P", "/R"],
            Self::Quiet => &["/S", "/R"],
            Self::BasicUi => &[],
        }
    }

    fn msi_args(self) -> &'static [&'static str] {
        match self {
            Self::BasicUi => &["/qb+"],
            Self::Quiet => &["/quiet"],
            Self::Passive => &["/passive"],
        }
    }
}

#[cfg(windows)]
#[derive(Default)]
struct WindowsUpdaterLaunchConfig {
    install_mode: WindowsInstallMode,
    installer_args: Vec<String>,
}

#[cfg(windows)]
fn install_windows_update(app: &AppHandle, update: &Update, bytes: &[u8]) -> Result<(), String> {
    use std::{
        env,
        os::windows::process::CommandExt,
        path::PathBuf,
        process::Command,
    };

    let install_dir = env::current_exe()
        .map_err(|e| format!("解析当前安装目录失败: {e}"))?
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| "解析当前安装目录失败: 缺少父目录".to_string())?;
    stop_related_install_dir_processes(&install_dir)?;

    let launch_config = read_windows_updater_launch_config(app);
    let (installer_kind, installer_path) = resolve_windows_installer(update, bytes)?;

    let mut command = match installer_kind {
        WindowsInstallerKind::Nsis => {
            let mut command = Command::new(&installer_path);
            for arg in launch_config.install_mode.nsis_args() {
                command.arg(arg);
            }
            command.arg("/UPDATE");

            let current_args = std::env::args_os().skip(1).collect::<Vec<_>>();
            if !current_args.is_empty() {
                command.raw_arg(" /ARGS");
                for arg in current_args.iter().map(escape_nsis_current_exe_arg) {
                    command.raw_arg(" ");
                    command.raw_arg(arg);
                }
            }
            for arg in &launch_config.installer_args {
                command.arg(arg);
            }

            command
        }
        WindowsInstallerKind::Msi => {
            let system_root =
                std::env::var_os("SYSTEMROOT").unwrap_or_else(|| "C:\\Windows".into());
            let msiexec_path = PathBuf::from(system_root).join("System32").join("msiexec.exe");

            let mut command = Command::new(msiexec_path);
            command
                .creation_flags(WINDOWS_CREATE_NO_WINDOW)
                .arg("/i")
                .arg(&installer_path)
                .args(launch_config.install_mode.msi_args())
                .arg("/promptrestart");
            for arg in &launch_config.installer_args {
                command.arg(arg);
            }
            command.arg("AUTOLAUNCHAPP=True");

            let escaped_args = std::env::args_os()
                .skip(1)
                .map(escape_msi_property_arg)
                .collect::<Vec<_>>()
                .join(" ");
            command.arg(format!("LAUNCHAPPARGS=\"{escaped_args}\""));

            command
        }
    };

    let child = command
        .spawn()
        .map_err(|e| format!("启动安装器失败: {e}"))?;
    info!(
        "[Updater] Windows 安装器已启动，PID={}，路径={}",
        child.id(),
        installer_path.display()
    );

    app.cleanup_before_exit();
    std::process::exit(0);
}

#[cfg(windows)]
fn stop_related_install_dir_processes(install_dir: &std::path::Path) -> Result<(), String> {
    use std::{os::windows::process::CommandExt, process::Command};

    let status = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            r#"
$ErrorActionPreference = 'Stop'
$installDir = $args[0]
$currentPid = [int]$args[1]
if ([string]::IsNullOrWhiteSpace($installDir) -or -not (Test-Path -LiteralPath $installDir)) { exit 0 }
$needle = ([System.IO.Path]::GetFullPath($installDir)).TrimEnd('\').ToLowerInvariant()
$killIds = New-Object 'System.Collections.Generic.HashSet[int]'
try {
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ExecutablePath)
} catch {
  try {
    $processes = @(Get-WmiObject Win32_Process -ErrorAction Stop | Select-Object ProcessId, ExecutablePath)
  } catch {
    exit 0
  }
}
foreach ($proc in $processes) {
  if ([int]$proc.ProcessId -eq $currentPid) { continue }
  $exe = $proc.ExecutablePath
  if ([string]::IsNullOrWhiteSpace($exe)) { continue }
  try {
    $normalized = ([System.IO.Path]::GetFullPath($exe)).TrimEnd('\').ToLowerInvariant()
  } catch {
    continue
  }
  if ($normalized -eq $needle -or $normalized.StartsWith($needle + '\')) {
    [void]$killIds.Add([int]$proc.ProcessId)
  }
}
if ($killIds.Count -gt 0) {
  Stop-Process -Id (@($killIds)) -Force -ErrorAction Stop
  Start-Sleep -Milliseconds 1200
}
exit 0
"#,
        ])
        .arg(install_dir)
        .arg(std::process::id().to_string())
        .creation_flags(WINDOWS_CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("升级前清理残留进程失败: {e}"))?;

    if status.success() {
        return Ok(());
    }

    Err(format!(
        "升级前清理安装目录残留进程失败，安装器未启动。退出其他 OpenClaw 相关进程后重试。退出码: {status}"
    ))
}

#[cfg(windows)]
fn read_windows_updater_launch_config(app: &AppHandle) -> WindowsUpdaterLaunchConfig {
    let mut config = WindowsUpdaterLaunchConfig::default();

    let updater = app.config().plugins.0.get("updater");
    let Some(updater) = updater else {
        return config;
    };
    let Some(windows) = updater.get("windows") else {
        return config;
    };

    if let Some(mode) = windows.get("installMode").and_then(|value| value.as_str()) {
        config.install_mode = match mode {
            "basicUi" => WindowsInstallMode::BasicUi,
            "quiet" => WindowsInstallMode::Quiet,
            _ => WindowsInstallMode::Passive,
        };
    }

    if let Some(args) = windows.get("installerArgs").and_then(|value| value.as_array()) {
        config.installer_args = args
            .iter()
            .filter_map(|value| value.as_str().map(ToString::to_string))
            .collect();
    }

    config
}

#[cfg(windows)]
fn resolve_windows_installer(
    update: &Update,
    bytes: &[u8],
) -> Result<(WindowsInstallerKind, std::path::PathBuf), String> {
    if is_zip_payload(update, bytes) {
        return extract_windows_zip_payload(update, bytes);
    }

    let installer_kind = detect_windows_installer_kind(update, bytes)?;
    let installer_path = persist_windows_installer(update, bytes, installer_kind)?;
    Ok((installer_kind, installer_path))
}

#[cfg(windows)]
fn detect_windows_installer_kind(
    update: &Update,
    bytes: &[u8],
) -> Result<WindowsInstallerKind, String> {
    let lower_path = update.download_url.path().to_ascii_lowercase();

    if lower_path.ends_with(".exe") {
        return Ok(WindowsInstallerKind::Nsis);
    }
    if lower_path.ends_with(".msi") {
        return Ok(WindowsInstallerKind::Msi);
    }

    if bytes.starts_with(b"MZ") {
        return Ok(WindowsInstallerKind::Nsis);
    }

    if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        return Ok(WindowsInstallerKind::Msi);
    }

    Err(format!(
        "无法识别 Windows 更新包格式: {}",
        update.download_url
    ))
}

#[cfg(windows)]
fn is_zip_payload(update: &Update, bytes: &[u8]) -> bool {
    let lower_path = update.download_url.path().to_ascii_lowercase();
    lower_path.ends_with(".zip") || bytes.starts_with(b"PK\x03\x04")
}

#[cfg(windows)]
fn persist_windows_installer(
    update: &Update,
    bytes: &[u8],
    installer_kind: WindowsInstallerKind,
) -> Result<std::path::PathBuf, String> {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    let extension = match installer_kind {
        WindowsInstallerKind::Nsis => "exe",
        WindowsInstallerKind::Msi => "msi",
    };
    let version = sanitize_filename_component(&update.version);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("生成更新临时文件名失败: {e}"))?
        .as_millis();

    let temp_dir = std::env::temp_dir().join("openclaw-desktop-updater");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建更新临时目录失败: {e}"))?;

    let path = PathBuf::from(temp_dir).join(format!("openclaw-update-{version}-{millis}.{extension}"));
    fs::write(&path, bytes).map_err(|e| format!("写入更新安装器失败: {e}"))?;

    Ok(path)
}

#[cfg(windows)]
fn extract_windows_zip_payload(
    update: &Update,
    bytes: &[u8],
) -> Result<(WindowsInstallerKind, std::path::PathBuf), String> {
    use std::{fs, path::PathBuf, process::Command};

    let version = sanitize_filename_component(&update.version);
    let temp_root = std::env::temp_dir().join("openclaw-desktop-updater");
    fs::create_dir_all(&temp_root).map_err(|e| format!("创建更新临时目录失败: {e}"))?;

    let zip_path = temp_root.join(format!("openclaw-update-{version}.zip"));
    fs::write(&zip_path, bytes).map_err(|e| format!("写入更新压缩包失败: {e}"))?;

    let extract_dir = temp_root.join(format!("openclaw-update-{version}-unzipped"));
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir).map_err(|e| format!("清理旧更新目录失败: {e}"))?;
    }
    fs::create_dir_all(&extract_dir).map_err(|e| format!("创建更新解压目录失败: {e}"))?;

    let status = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
        ])
        .arg(&zip_path)
        .arg(&extract_dir)
        .status()
        .map_err(|e| format!("解压更新包失败: {e}"))?;
    if !status.success() {
        return Err(format!("解压更新包失败，PowerShell 退出码: {status}"));
    }

    let candidates = collect_installer_candidates(&extract_dir)?;
    let exe_path = candidates
        .iter()
        .find(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        })
        .cloned();
    if let Some(path) = exe_path {
        return Ok((WindowsInstallerKind::Nsis, path));
    }

    let msi_path = candidates
        .iter()
        .find(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("msi"))
        })
        .cloned();
    if let Some(path) = msi_path {
        return Ok((WindowsInstallerKind::Msi, path));
    }

    Err(format!(
        "ZIP 更新包中未找到可执行安装器: {}",
        PathBuf::from(&zip_path).display()
    ))
}

#[cfg(windows)]
fn collect_installer_candidates(root: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    use std::{fs, path::PathBuf};

    let mut stack = vec![root.to_path_buf()];
    let mut results = Vec::new();

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)
            .map_err(|e| format!("读取更新解压目录失败 ({}): {e}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取更新文件项失败: {e}"))?;
            let path: PathBuf = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            let is_candidate = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    ext.eq_ignore_ascii_case("exe") || ext.eq_ignore_ascii_case("msi")
                });
            if is_candidate {
                results.push(path);
            }
        }
    }

    Ok(results)
}

#[cfg(windows)]
fn sanitize_filename_component(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '-'
            }
        })
        .collect();

    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

#[cfg(windows)]
fn escape_nsis_current_exe_arg(arg: impl AsRef<std::ffi::OsStr>) -> String {
    // NSIS 会把 / 开头的值当成安装器自身参数，这里沿用上游 updater 的转义策略。
    let arg = arg.as_ref().to_string_lossy();
    let mut cmd: Vec<char> = Vec::new();

    let quote = arg.chars().any(|c| c == ' ' || c == '\t' || c == '/') || arg.is_empty();
    let escape = true;
    if quote {
        cmd.push('"');
    }
    let mut backslashes: usize = 0;
    for ch in arg.chars() {
        if escape {
            if ch == '\\' {
                backslashes += 1;
            } else {
                if ch == '"' {
                    cmd.extend((0..=backslashes).map(|_| '\\'));
                }
                backslashes = 0;
            }
        }
        cmd.push(ch);
    }
    if quote {
        cmd.extend((0..backslashes).map(|_| '\\'));
        cmd.push('"');
    }
    cmd.into_iter().collect()
}

#[cfg(windows)]
fn escape_msi_property_arg(arg: impl AsRef<std::ffi::OsStr>) -> String {
    let mut arg = arg.as_ref().to_string_lossy().to_string();

    if arg.is_empty() {
        return "\"\"\"\"".to_string();
    }
    if !arg.contains(' ') && !arg.contains('"') {
        return arg;
    }

    if arg.contains('"') {
        arg = arg.replace('"', r#""""""#);
    }

    if arg.starts_with('-') {
        if let Some((left, right)) = arg.split_once('=') {
            format!("{left}=\"\"{right}\"\"")
        } else {
            format!("\"\"{arg}\"\"")
        }
    } else {
        format!("\"\"{arg}\"\"")
    }
}
