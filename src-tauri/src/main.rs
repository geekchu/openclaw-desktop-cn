// 防止 Windows 系统显示控制台窗口
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod gateway;
mod models;
mod utils;

use commands::{config, diagnostics, installer, process, service, terminal};
use std::path::PathBuf;
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

/// 托盘菜单项引用，用于动态更新状态
pub struct TrayState {
    pub status_item: MenuItem<tauri::Wry>,
    pub start_item: MenuItem<tauri::Wry>,
    pub stop_item: MenuItem<tauri::Wry>,
    pub restart_item: MenuItem<tauri::Wry>,
}

/// 解析 gateway bundle 目录
/// - 开发模式：使用项目根目录（CARGO_MANIFEST_DIR 的父目录）
/// - 生产模式：使用 Tauri resource_dir 下的 gateway-bundle/
#[allow(unused_variables)]
fn resolve_gateway_bundle_dir(app: &tauri::App) -> PathBuf {
    // 开发模式：使用项目根目录（CARGO_MANIFEST_DIR 的父目录）
    // 项目根目录包含完整的 node_modules、extensions 依赖和 docs/ 模板
    #[cfg(debug_assertions)]
    {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let project_root = PathBuf::from(manifest_dir).parent().unwrap().to_path_buf();
        log::info!("[Main] 开发模式 - gateway 目录（项目根）: {}", project_root.display());
        return project_root;
    }

    // 生产模式：检查 resource_dir/gateway-bundle/
    #[cfg(not(debug_assertions))]
    {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundle_dir = resource_dir.join("gateway-bundle");
            if bundle_dir.exists() {
                log::info!("[Main] 生产模式 - gateway bundle 目录: {}", bundle_dir.display());
                return bundle_dir;
            }
            log::warn!("[Main] gateway-bundle 目录不存在: {}", bundle_dir.display());
        }

        // 回退：exe 同级目录
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let bundle_dir = exe_dir.join("gateway-bundle");
                if bundle_dir.exists() {
                    log::info!("[Main] 回退 - gateway bundle 目录: {}", bundle_dir.display());
                    return bundle_dir;
                }
            }
        }

        // 最终回退：当前目录
        let cwd = std::env::current_dir().unwrap_or_default();
        log::warn!("[Main] 未找到 gateway bundle，使用当前目录: {}", cwd.display());
        cwd
    }
}

/// 从 ~/.openclawcn/openclaw.json 读取 gateway.auth.token
pub(crate) fn read_gateway_token() -> Option<String> {
    let config_path = utils::platform::get_config_file_path();
    let content = utils::file::read_file(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    config
        .pointer("/gateway/auth/token")
        .and_then(|v| v.as_str())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
}

/// 显示/聚焦主窗口
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    // 初始化日志 - 默认显示 info 级别日志
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    ).init();

    log::info!("OpenClaw桌面版 启动");

    tauri::Builder::default()
        // 单实例插件 — 必须在所有其他插件之前注册
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 第二个实例启动时，聚焦已有窗口
            show_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        // 允许 webview 导航到 localhost（默认只允许 tauri:// 协议）
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-guard")
                .on_navigation(|_window, url| {
                    let host = url.host_str().unwrap_or("");
                    let allowed = url.scheme() == "tauri"
                        || host == "localhost"
                        || host == "127.0.0.1";
                    if !allowed {
                        log::warn!("[Navigation] 阻止导航到: {}", url);
                    }
                    allowed
                })
                .build(),
        )
        .setup(|app| {
            // 自动更新插件
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            // 解析并设置 gateway bundle 目录
            let gateway_dir = resolve_gateway_bundle_dir(app);
            // Windows 上 Tauri 的 resource_dir() 返回 \\?\ 前缀的路径，
            // Node.js 无法正确解析此前缀（会导致 EISDIR: lstat 'C:' 错误），需要去掉
            let gateway_dir_str = gateway_dir.to_str().unwrap_or(".");
            #[cfg(windows)]
            let gateway_dir_str = gateway_dir_str.strip_prefix("\\\\?\\").unwrap_or(gateway_dir_str);
            std::env::set_var("OPENCLAW_GATEWAY_BUNDLE_DIR", gateway_dir_str);
            log::info!("[Main] OPENCLAW_GATEWAY_BUNDLE_DIR = {}", gateway_dir_str);

            // 创建 GatewayManager 并存储到 app state
            let gm = gateway::GatewayManager::new(18789);
            app.manage(gm);

            // 创建终端状态管理
            app.manage(terminal::TerminalState::new());

            // ── 系统托盘 ──
            let status_item = MenuItem::with_id(
                app, "status", "Gateway: 检测中...", false, None::<&str>,
            )?;
            let start_item = MenuItem::with_id(
                app, "start", "启动 Gateway", false, None::<&str>,
            )?;
            let stop_item = MenuItem::with_id(
                app, "stop", "停止 Gateway", false, None::<&str>,
            )?;
            let restart_item = MenuItem::with_id(
                app, "restart", "重启 Gateway", false, None::<&str>,
            )?;
            let open_item = MenuItem::with_id(
                app, "open", "打开面板", true, None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(
                app, "quit", "退出", true, None::<&str>,
            )?;

            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;

            let menu = MenuBuilder::new(app)
                .item(&status_item)
                .item(&sep1)
                .item(&start_item)
                .item(&stop_item)
                .item(&restart_item)
                .item(&sep2)
                .item(&open_item)
                .item(&sep3)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("应用图标缺失"))
                .menu(&menu)
                .tooltip("OpenClaw桌面版")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "open" => {
                            show_main_window(app);
                        }
                        "start" => {
                            let handle = app.clone();
                            std::thread::spawn(move || {
                                let gm = handle.state::<gateway::GatewayManager>();
                                if let Err(e) = gm.start() {
                                    log::error!("[Tray] 启动 Gateway 失败: {}", e);
                                }
                            });
                        }
                        "stop" => {
                            let handle = app.clone();
                            std::thread::spawn(move || {
                                let gm = handle.state::<gateway::GatewayManager>();
                                gm.stop();
                            });
                        }
                        "restart" => {
                            let handle = app.clone();
                            std::thread::spawn(move || {
                                let gm = handle.state::<gateway::GatewayManager>();
                                gm.stop();
                                std::thread::sleep(std::time::Duration::from_secs(1));
                                if let Err(e) = gm.start() {
                                    log::error!("[Tray] 重启 Gateway 失败: {}", e);
                                }
                            });
                        }
                        "quit" => {
                            let gm = app.state::<gateway::GatewayManager>();
                            gm.stop();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键点击托盘图标 → 显示主窗口
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // 存储托盘状态到 app state（用于健康检查动态更新）
            app.manage(TrayState {
                status_item,
                start_item,
                stop_item,
                restart_item,
            });

            // 开机自启动时 --minimized 参数：隐藏窗口，仅保留托盘
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // 异步启动 gateway + 等待就绪 + 通知前端
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let gm = handle.state::<gateway::GatewayManager>();

                // 确保 config 中 token 已写入（供 session_gateway_token() 和 webview 读取）
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => {
                        if let Err(e) = rt.block_on(config::get_or_create_gateway_token()) {
                            log::warn!("[Main] 预初始化 gateway token 失败: {}", e);
                        }
                    }
                    Err(e) => log::warn!("[Main] 创建 tokio runtime 失败: {}", e),
                }

                // 确保所有内置渠道插件在配置中已启用
                if let Err(e) = config::ensure_channel_plugins_enabled() {
                    log::warn!("[Main] 预初始化渠道插件配置失败: {}", e);
                }

                // 发送状态：正在启动
                let _ = handle.emit("gateway-status", "正在启动 Gateway...");

                match gm.start() {
                    Ok(_) => {
                        let _ = handle.emit("gateway-status", "正在等待 Gateway 就绪...");
                        if gm.wait_for_ready(300) {
                            // Gateway 就绪，直接导航 webview 到 gateway URL
                            let url = if let Some(token) = read_gateway_token() {
                                format!("http://localhost:18789?token={}", token)
                            } else {
                                "http://localhost:18789".to_string()
                            };
                            let _ = handle.emit("gateway-ready", url.as_str());
                            // 使用 Tauri navigate API（绕过 webview 安全策略限制）
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.navigate(url.parse().unwrap());
                            }
                        } else {
                            let _ = handle.emit("gateway-status", "Gateway 启动超时");
                            gateway::send_startup_timeout_notification(&handle);
                        }
                    }
                    Err(e) => {
                        let _ = handle.emit("gateway-status", format!("启动失败: {}", e).as_str());
                    }
                }

                // 启动健康检查循环（阻塞当前线程）
                gateway::health_check_loop(&handle);
            });

            Ok(())
        })
        // 关闭窗口时隐藏而非退出（最小化到托盘）
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 服务管理
            service::get_service_status,
            service::start_service,
            service::stop_service,
            service::restart_service,
            service::get_logs,
            // 进程管理
            process::check_openclaw_installed,
            process::get_openclaw_version,
            process::check_port_in_use,
            // 配置管理
            config::get_config,
            config::save_config,
            config::get_exec_approvals,
            config::save_exec_approvals,
            config::get_env_value,
            config::save_env_value,
            config::get_ai_providers,
            config::get_channels_config,
            config::save_channel_config,
            config::clear_channel_config,
            // Gateway Token
            config::get_or_create_gateway_token,
            config::get_dashboard_url,
            // 桌面端配置
            config::get_desktop_config,
            config::save_desktop_config,
            // AI 配置管理
            config::get_official_providers,
            config::get_ai_config,
            config::save_provider,
            config::delete_provider,
            config::set_primary_model,
            config::switch_model,
            config::add_available_model,
            config::remove_available_model,
            // 飞书插件管理
            config::check_feishu_plugin,
            config::install_feishu_plugin,
            // 配对码审批
            config::list_pairing_requests,
            config::approve_pairing_code,
            // 目录操作
            config::open_config_dir,
            config::pick_folder,
            // 开机自启
            config::autostart_is_enabled,
            config::autostart_enable,
            config::autostart_disable,
            // 诊断测试
            diagnostics::run_doctor,
            diagnostics::test_ai_connection,
            diagnostics::test_channel,
            diagnostics::get_system_info,
            diagnostics::start_channel_login,
            // 安装器
            installer::check_environment,
            installer::install_nodejs,
            installer::install_openclaw,
            installer::init_openclaw_config,
            installer::open_install_terminal,
            installer::uninstall_openclaw,
            // 版本更新
            installer::check_openclaw_update,
            installer::update_openclaw,
            // 内嵌终端
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_destroy,
        ])
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用失败")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // 应用退出时停止 gateway
                let gm = app_handle.state::<gateway::GatewayManager>();
                gm.stop();
            }
        });
}
