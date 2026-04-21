use crate::models::{AITestResult, ChannelTestResult, DiagnosticResult, SystemInfo};
use crate::utils::{platform, shell};
use log::{debug, info, warn};
use serde_json::Value;
use tauri::{command, Manager};

/// 去除 ANSI 转义序列（颜色代码等）
fn strip_ansi_codes(input: &str) -> String {
    // 匹配 ANSI 转义序列: ESC[ ... m 或 ESC[ ... 其他控制字符
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // 跳过 ESC[...m 序列
            if chars.peek() == Some(&'[') {
                chars.next(); // 跳过 '['
                              // 跳过直到遇到字母
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// 从混合输出中提取 JSON 内容
fn extract_json_from_output(output: &str) -> Option<String> {
    // 先去除 ANSI 颜色代码
    let clean_output = strip_ansi_codes(output);

    // 按行查找 JSON 开始位置
    let lines: Vec<&str> = clean_output.lines().collect();
    let mut json_start_line = None;
    let mut json_end_line = None;

    // 找到 JSON 开始行：
    // - 以 { 开头（JSON 对象）
    // - 或以 [" 或 [数字 开头（真正的 JSON 数组，不是 [plugins] 这样的文本）
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') {
            json_start_line = Some(i);
            break;
        }
        // 检查是否是真正的 JSON 数组（以 [" 或 [数字 或 [{ 开头）
        if trimmed.starts_with('[') && trimmed.len() > 1 {
            let second_char = trimmed.chars().nth(1).unwrap_or(' ');
            if second_char == '"'
                || second_char == '{'
                || second_char == '['
                || second_char.is_ascii_digit()
            {
                json_start_line = Some(i);
                break;
            }
        }
    }

    // 找到 JSON 结束行（以 } 或 ] 结尾的行，从后往前找）
    for (i, line) in lines.iter().enumerate().rev() {
        let trimmed = line.trim();
        if trimmed == "}" || trimmed == "}," || trimmed.ends_with('}') {
            json_end_line = Some(i);
            break;
        }
        if trimmed == "]" || trimmed == "]," {
            json_end_line = Some(i);
            break;
        }
    }

    match (json_start_line, json_end_line) {
        (Some(start), Some(end)) if start <= end => {
            let json_lines: Vec<&str> = lines[start..=end].to_vec();
            let json_str = json_lines.join("\n");
            Some(json_str)
        }
        _ => None,
    }
}

fn extract_provider_from_model_ref(model_ref: &str) -> Option<String> {
    let trimmed = model_ref.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (provider, _) = trimmed.split_once('/')?;
    let provider = provider.trim();
    if provider.is_empty() {
        None
    } else {
        Some(provider.to_string())
    }
}

fn read_current_primary_model_ref() -> Option<String> {
    let config_path = platform::get_config_file_path();
    let content = std::fs::read_to_string(config_path).ok()?;
    let config: Value = serde_json::from_str(&content).ok()?;
    config
        .pointer("/agents/defaults/model/primary")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn clean_ai_test_output(output: &str) -> String {
    strip_ansi_codes(output)
        .lines()
        .filter(|line| !line.contains("ExperimentalWarning"))
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<&str>>()
        .join("\n")
}

fn detect_ai_test_error(output: &str) -> Option<String> {
    let lower = output.to_lowercase();
    let has_api_error = lower.contains("api error")
        || lower.contains("api_error")
        || lower.contains("authentication failed")
        || lower.contains("invalid api key")
        || lower.contains("unauthorized")
        || lower.contains("rate limit")
        || lower.contains("quota exceeded")
        || lower.contains("connection refused")
        || lower.contains("timeout")
        || lower.contains("econnrefused")
        || lower.contains("enotfound")
        || lower.contains("fetch failed")
        || lower.contains("network error");
    let has_http_error = lower.contains("status 401")
        || lower.contains("status: 401")
        || lower.contains("error 401")
        || lower.contains("code 401")
        || lower.contains("code: 401")
        || lower.contains("status 403")
        || lower.contains("status: 403")
        || lower.contains("error 403")
        || lower.contains("code 403")
        || lower.contains("code: 403")
        || lower.contains("status 429")
        || lower.contains("status: 429")
        || lower.contains("error 429")
        || lower.contains("code 429")
        || lower.contains("code: 429")
        || lower.contains("status 500")
        || lower.contains("status: 500")
        || lower.contains("error 500")
        || lower.contains("status 502")
        || lower.contains("status: 502")
        || lower.contains("status 503")
        || lower.contains("status: 503");

    if has_api_error || has_http_error {
        Some(output.to_string())
    } else {
        None
    }
}

const AI_TEST_PROBE_TIMEOUT_MS: u64 = 13_000;
const AI_TEST_PROBE_MAX_TOKENS: u64 = 8;

fn build_ai_probe_args(
    provider_override: Option<&str>,
    model_override: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "models".to_string(),
        "status".to_string(),
        "--json".to_string(),
        "--probe".to_string(),
        "--probe-timeout".to_string(),
        AI_TEST_PROBE_TIMEOUT_MS.to_string(),
        "--probe-concurrency".to_string(),
        "1".to_string(),
        "--probe-max-tokens".to_string(),
        AI_TEST_PROBE_MAX_TOKENS.to_string(),
    ];

    if let Some(provider) = provider_override {
        args.push("--probe-provider".to_string());
        args.push(provider.to_string());
    }
    if let Some(model) = model_override {
        args.push("--probe-model".to_string());
        args.push(model.to_string());
    }

    args
}

fn format_provider_model_ref(
    provider: Option<&str>,
    model: Option<&str>,
    fallback_model: &str,
) -> String {
    let provider = normalize_optional_string(provider);
    let model = normalize_optional_string(model);
    match (provider.as_deref(), model.as_deref()) {
        (_, Some(model)) if model.contains('/') => model.to_string(),
        (Some(provider), Some(model)) => format!("{provider}/{model}"),
        (None, Some(model)) => model.to_string(),
        _ => fallback_model.to_string(),
    }
}

fn parse_ai_probe_result(
    output: &str,
    selected_provider: Option<&str>,
    selected_model: &str,
    selected_profile: Option<&str>,
    fallback_latency_ms: u64,
) -> AITestResult {
    let provider_label = selected_provider.unwrap_or("current").to_string();

    let json_text = match extract_json_from_output(output) {
        Some(json) => json,
        None => {
            let cleaned = clean_ai_test_output(output);
            let error = detect_ai_test_error(&cleaned).unwrap_or_else(|| {
                if cleaned.is_empty() {
                    "连接测试没有返回可解析结果".to_string()
                } else {
                    format!("连接测试返回了不可解析结果: {}", cleaned)
                }
            });
            return AITestResult {
                success: false,
                provider: provider_label,
                model: selected_model.to_string(),
                response: None,
                error: Some(error),
                latency_ms: Some(fallback_latency_ms),
            };
        }
    };

    let payload: Value = match serde_json::from_str(&json_text) {
        Ok(value) => value,
        Err(err) => {
            return AITestResult {
                success: false,
                provider: provider_label,
                model: selected_model.to_string(),
                response: None,
                error: Some(format!("连接测试结果不是有效 JSON: {}", err)),
                latency_ms: Some(fallback_latency_ms),
            };
        }
    };

    let probe_results = payload
        .pointer("/auth/probes/results")
        .and_then(|value| value.as_array());
    let probe_result = probe_results.and_then(|results| {
        results
            .iter()
            .filter(|entry| {
                selected_provider.is_none_or(|provider| {
                    entry.get("provider").and_then(|value| value.as_str()) == Some(provider)
                })
            })
            .max_by_key(|entry| {
                let profile_score = selected_profile.is_some_and(|profile| {
                    entry.get("profileId").and_then(|value| value.as_str()) == Some(profile)
                }) as u8;
                let model_score = (entry.get("model").and_then(|value| value.as_str())
                    == Some(selected_model)) as u8;
                let status_score = match entry.get("status").and_then(|value| value.as_str()) {
                    Some("ok") => 6_u8,
                    Some("auth" | "rate_limit" | "billing" | "timeout" | "format") => 5_u8,
                    Some("no_model") => 4_u8,
                    Some("unknown") => 2_u8,
                    Some(_) => 3_u8,
                    None => 1_u8,
                };
                let latency_score = entry
                    .get("latencyMs")
                    .and_then(|value| value.as_u64())
                    .is_some() as u8;
                (profile_score, model_score, status_score, latency_score)
            })
            .or_else(|| results.first())
    });

    let Some(probe_result) = probe_result else {
        return AITestResult {
            success: false,
            provider: provider_label,
            model: selected_model.to_string(),
            response: None,
            error: Some("没有找到可用的模型探测结果，请先保存有效的模型配置".to_string()),
            latency_ms: Some(fallback_latency_ms),
        };
    };

    let actual_provider = probe_result
        .get("provider")
        .and_then(|value| value.as_str());
    let provider = actual_provider
        .unwrap_or(selected_provider.unwrap_or("current"))
        .to_string();
    let model = format_provider_model_ref(
        actual_provider.or(selected_provider),
        probe_result.get("model").and_then(|value| value.as_str()),
        selected_model,
    );
    let latency_ms = probe_result
        .get("latencyMs")
        .and_then(|value| value.as_u64())
        .unwrap_or(fallback_latency_ms);
    let status = probe_result
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");
    let detail = probe_result
        .get("error")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    if status == "ok" {
        return AITestResult {
            success: true,
            provider,
            model,
            response: Some("Probe OK".to_string()),
            error: None,
            latency_ms: Some(latency_ms),
        };
    }

    let error = detail.unwrap_or_else(|| match status {
        "auth" => "认证失败，请检查 API Key 或登录状态".to_string(),
        "rate_limit" => "请求被限流，请稍后重试".to_string(),
        "billing" => "额度或计费状态异常，请检查提供商账户".to_string(),
        "timeout" => "连接测试超时".to_string(),
        "format" => "模型返回格式异常".to_string(),
        "no_model" => "没有可用于测试的模型".to_string(),
        other => format!("连接测试失败 ({})", other),
    });

    AITestResult {
        success: false,
        provider,
        model,
        response: None,
        error: Some(error),
        latency_ms: Some(latency_ms),
    }
}

/// 运行诊断
#[command]
pub async fn run_doctor() -> Result<Vec<DiagnosticResult>, String> {
    info!("[诊断] 开始运行系统诊断...");
    let mut results = Vec::new();

    // 检查 OpenClaw 是否安装（全局安装或 bundle 模式）
    info!("[诊断] 检查 OpenClaw 安装状态...");
    let has_global = shell::get_openclaw_path().is_some();
    let has_bundle = shell::get_bundle_entry().is_some();
    let openclaw_installed = has_global || has_bundle;
    info!(
        "[诊断] OpenClaw 安装: {} (global={}, bundle={})",
        if openclaw_installed { "✓" } else { "✗" },
        has_global,
        has_bundle
    );
    results.push(DiagnosticResult {
        name: "OpenClaw 安装".to_string(),
        passed: openclaw_installed,
        message: if has_bundle && !has_global {
            "OpenClaw 已安装 (内置模式)".to_string()
        } else if openclaw_installed {
            "OpenClaw 已安装".to_string()
        } else {
            "OpenClaw 未安装".to_string()
        },
        suggestion: if openclaw_installed {
            None
        } else {
            Some("运行: npm install -g openclaw".to_string())
        },
    });

    // 检查 Node.js（使用 get_node_path 以在生产模式下使用内置版本）
    let node_check = match shell::get_node_path() {
        Some(node_path) => shell::run_command_output(&node_path, &["--version"]),
        None => Err("未安装".to_string()),
    };
    results.push(DiagnosticResult {
        name: "Node.js".to_string(),
        passed: node_check.is_ok(),
        message: node_check.clone().unwrap_or_else(|_| "未安装".to_string()),
        suggestion: if node_check.is_err() {
            Some("请安装 Node.js 22+".to_string())
        } else {
            None
        },
    });

    // 检查配置文件
    let config_path = platform::get_config_file_path();
    let config_exists = std::path::Path::new(&config_path).exists();
    results.push(DiagnosticResult {
        name: "配置文件".to_string(),
        passed: config_exists,
        message: if config_exists {
            format!("配置文件存在: {}", config_path)
        } else {
            "配置文件不存在".to_string()
        },
        suggestion: if config_exists {
            None
        } else {
            Some("运行 openclaw 初始化配置".to_string())
        },
    });

    // 检查环境变量文件（不存在则自动创建）
    let env_path = platform::get_env_file_path();
    let env_exists = std::path::Path::new(&env_path).exists();
    if !env_exists {
        // 确保配置目录存在，然后创建空 env 文件
        let config_dir = platform::get_config_dir();
        let _ = std::fs::create_dir_all(&config_dir);
        let _ = std::fs::write(&env_path, "");
    }
    results.push(DiagnosticResult {
        name: "环境变量".to_string(),
        passed: true,
        message: format!("环境变量文件: {}", env_path),
        suggestion: None,
    });

    // 运行 openclaw doctor
    if openclaw_installed {
        let doctor_result = shell::run_openclaw(&["doctor"]);
        let doctor_output = doctor_result
            .map(|s| strip_ansi_codes(&s))
            .unwrap_or_else(|e| strip_ansi_codes(&e));
        results.push(DiagnosticResult {
            name: "OpenClaw Doctor".to_string(),
            passed: !doctor_output.contains("invalid"),
            message: doctor_output,
            suggestion: None,
        });
    }

    Ok(results)
}

/// 测试 AI 连接
#[command]
pub async fn test_ai_connection(
    provider: Option<String>,
    model: Option<String>,
) -> Result<AITestResult, String> {
    info!("[AI测试] 开始测试 AI 连接...");
    let selected_model_ref =
        normalize_optional_string(model.as_deref()).or_else(read_current_primary_model_ref);
    let selected_provider = normalize_optional_string(provider.as_deref()).or_else(|| {
        selected_model_ref
            .as_deref()
            .and_then(extract_provider_from_model_ref)
    });
    let selected_model_label = selected_model_ref
        .clone()
        .unwrap_or_else(|| "default".to_string());
    let owned_args =
        build_ai_probe_args(selected_provider.as_deref(), selected_model_ref.as_deref());
    let args: Vec<&str> = owned_args.iter().map(String::as_str).collect();
    let start = std::time::Instant::now();

    info!("[AI测试] 执行: openclaw {}", args.join(" "));
    let output = match shell::run_openclaw(&args) {
        Ok(output) => output,
        Err(error) => error,
    };
    let latency_ms = start.elapsed().as_millis() as u64;
    info!("[AI测试] 命令执行完成, 耗时: {}ms", latency_ms);

    debug!("[AI测试] 原始输出: {}", output);
    let parsed = parse_ai_probe_result(
        &output,
        selected_provider.as_deref(),
        &selected_model_label,
        None,
        latency_ms,
    );
    if parsed.success {
        info!(
            "[AI测试] ✓ AI 连接测试成功: provider={}, model={}, latency={:?}ms",
            parsed.provider, parsed.model, parsed.latency_ms
        );
    } else {
        warn!(
            "[AI测试] ✗ AI 连接测试失败: provider={}, model={}, error={}",
            parsed.provider,
            parsed.model,
            parsed.error.as_deref().unwrap_or("unknown")
        );
    }
    Ok(parsed)
}

/// 获取渠道测试目标
fn get_channel_test_target(channel_type: &str) -> Option<String> {
    let env_path = platform::get_env_file_path();

    // 根据渠道类型获取测试目标的环境变量
    let env_key = match channel_type.to_lowercase().as_str() {
        "telegram" => "OPENCLAW_TELEGRAM_USERID",
        "discord" => "OPENCLAW_DISCORD_TESTCHANNELID",
        "slack" => "OPENCLAW_SLACK_TESTCHANNELID",
        "feishu" => "OPENCLAW_FEISHU_TESTCHATID",
        // WhatsApp 是扫码登录，不需要测试目标发送消息
        "whatsapp" => return None,
        // iMessage 也不需要测试目标
        "imessage" => return None,
        _ => return None,
    };

    crate::utils::file::read_env_value(&env_path, env_key)
}

/// 检查渠道是否需要发送测试消息
fn channel_needs_send_test(channel_type: &str) -> bool {
    match channel_type.to_lowercase().as_str() {
        // 这些渠道需要发送测试消息来验证
        "telegram" | "discord" | "slack" | "feishu" => true,
        // WhatsApp 和 iMessage 只检查状态，不发送测试消息
        "whatsapp" | "imessage" => false,
        _ => false,
    }
}

fn channel_requires_linked_status(channel_type: &str) -> bool {
    matches!(channel_type.to_lowercase().as_str(), "whatsapp")
}

fn channel_requires_probe_status(channel_type: &str) -> bool {
    matches!(channel_type.to_lowercase().as_str(), "imessage")
}

fn channel_requires_running_status(channel_type: &str) -> bool {
    matches!(channel_type.to_lowercase().as_str(), "dingtalk" | "qqbot")
}

fn channel_requires_connected_status(channel_type: &str) -> bool {
    matches!(channel_type.to_lowercase().as_str(), "qqbot")
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedChannelStatus {
    configured: bool,
    linked: Option<bool>,
    running: Option<bool>,
    connected: Option<bool>,
    probe_ok: Option<bool>,
    last_error: Option<String>,
    probe_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ChannelStatusCheck {
    Ready {
        status_message: String,
    },
    NotConfigured,
    NotReady {
        status_message: String,
        error: String,
    },
}

fn read_status_bool(value: Option<&serde_json::Value>, key: &str) -> Option<bool> {
    value
        .and_then(|record| record.get(key))
        .and_then(|field| field.as_bool())
}

fn read_status_string(value: Option<&serde_json::Value>, key: &str) -> Option<String> {
    value
        .and_then(|record| record.get(key))
        .and_then(|field| field.as_str())
        .map(|field| field.trim().to_string())
        .filter(|field| !field.is_empty())
}

fn read_probe_ok(value: Option<&serde_json::Value>) -> Option<bool> {
    value
        .and_then(|record| record.get("probe"))
        .and_then(|probe| probe.get("ok"))
        .and_then(|field| field.as_bool())
}

fn read_probe_error(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(|record| record.get("probe"))
        .and_then(|probe| probe.get("error"))
        .and_then(|field| field.as_str())
        .map(|field| field.trim().to_string())
        .filter(|field| !field.is_empty())
}

fn parse_channel_status(
    json: &serde_json::Value,
    channel_type: &str,
) -> Option<ParsedChannelStatus> {
    let channel_key = channel_type.to_lowercase();
    let channels = json.get("channels")?.as_object()?;
    let channel_summary = channels.get(&channel_key)?;
    let default_account_id = json
        .get("channelDefaultAccountId")
        .and_then(|value| value.get(&channel_key))
        .and_then(|value| value.as_str());
    let default_account = json
        .get("channelAccounts")
        .and_then(|value| value.get(&channel_key))
        .and_then(|value| value.as_array())
        .and_then(|accounts| {
            default_account_id
                .and_then(|account_id| {
                    accounts.iter().find(|account| {
                        account.get("accountId").and_then(|value| value.as_str())
                            == Some(account_id)
                    })
                })
                .or_else(|| accounts.first())
        });

    Some(ParsedChannelStatus {
        configured: read_status_bool(default_account, "configured")
            .or_else(|| read_status_bool(Some(channel_summary), "configured"))
            .unwrap_or(false),
        linked: read_status_bool(default_account, "linked")
            .or_else(|| read_status_bool(Some(channel_summary), "linked")),
        running: read_status_bool(default_account, "running")
            .or_else(|| read_status_bool(Some(channel_summary), "running")),
        connected: read_status_bool(default_account, "connected")
            .or_else(|| read_status_bool(Some(channel_summary), "connected")),
        probe_ok: read_probe_ok(default_account).or_else(|| read_probe_ok(Some(channel_summary))),
        last_error: read_status_string(default_account, "lastError")
            .or_else(|| read_status_string(Some(channel_summary), "lastError")),
        probe_error: read_probe_error(default_account)
            .or_else(|| read_probe_error(Some(channel_summary))),
    })
}

fn evaluate_channel_status(channel_type: &str, status: &ParsedChannelStatus) -> ChannelStatusCheck {
    if !status.configured {
        return ChannelStatusCheck::NotConfigured;
    }

    if channel_requires_linked_status(channel_type) && status.linked != Some(true) {
        return ChannelStatusCheck::NotReady {
            status_message: "等待扫码登录".to_string(),
            error: format!("请先扫码登录 {}，然后重试", channel_type),
        };
    }

    if channel_requires_probe_status(channel_type) && status.probe_ok != Some(true) {
        return ChannelStatusCheck::NotReady {
            status_message: "探测失败".to_string(),
            error: status
                .probe_error
                .clone()
                .or_else(|| status.last_error.clone())
                .unwrap_or_else(|| format!("请确认 {} 已可用，然后重试", channel_type)),
        };
    }

    if channel_requires_running_status(channel_type) && status.running != Some(true) {
        return ChannelStatusCheck::NotReady {
            status_message: "未运行".to_string(),
            error: status
                .last_error
                .clone()
                .or_else(|| status.probe_error.clone())
                .unwrap_or_else(|| {
                    format!("请确认 {} Gateway 已启动并保持在线，然后重试", channel_type)
                }),
        };
    }

    if channel_requires_connected_status(channel_type) && status.connected != Some(true) {
        return ChannelStatusCheck::NotReady {
            status_message: if status.running == Some(true) {
                "已启动但未连接".to_string()
            } else {
                "未连接".to_string()
            },
            error: status
                .last_error
                .clone()
                .or_else(|| status.probe_error.clone())
                .unwrap_or_else(|| format!("请确认 {} 已连接成功，然后重试", channel_type)),
        };
    }

    let status_message = if status.linked == Some(true) {
        "已链接".to_string()
    } else if status.connected == Some(true) {
        "已连接".to_string()
    } else if status.running == Some(true) {
        "运行中".to_string()
    } else if status.probe_ok == Some(true) {
        "探测正常".to_string()
    } else {
        "已配置".to_string()
    };

    ChannelStatusCheck::Ready { status_message }
}

/// 从文本输出解析渠道状态
/// 格式: "- Telegram default: enabled, configured, mode:polling, token:config"
#[cfg(target_os = "windows")]
fn powershell_single_quote(value: &str) -> String {
    value.replace("'", "''")
}
#[cfg(not(target_os = "windows"))]
fn sh_single_quote(value: &str) -> String {
    value.replace("'", r#"'"'"'"#)
}

#[cfg(not(target_os = "windows"))]
fn build_unix_openclaw_launcher(app: &tauri::AppHandle) -> Result<(String, String), String> {
    let mut path_parts: Vec<String> = Vec::new();
    let mut extra_env: Vec<(String, String)> =
        shell::load_openclaw_env_vars().into_iter().collect();

    extra_env.push((
        "OPENCLAW_GATEWAY_TOKEN".to_string(),
        shell::session_gateway_token().to_string(),
    ));
    extra_env.push(("OPENCLAW_DESKTOP".to_string(), "1".to_string()));
    extra_env.push(("OPENCLAW_NO_RESPAWN".to_string(), "1".to_string()));
    let gm = app.state::<crate::gateway::GatewayManager>();
    let port = gm.get_port();
    extra_env.push(("OPENCLAW_GATEWAY_PORT".to_string(), port.to_string()));
    extra_env.push(("OPENCLAW_STATE_DIR".to_string(), platform::get_config_dir()));

    if let Some(prefix) = shell::get_npm_global_prefix() {
        extra_env.push((
            "NPM_CONFIG_PREFIX".to_string(),
            prefix.to_string_lossy().to_string(),
        ));
    }

    let launcher = if let (Some(node_path), Some((bundle_dir, entry_point))) =
        (shell::get_node_path(), shell::get_bundle_entry())
    {
        if let Some(parent) = std::path::Path::new(&node_path).parent() {
            path_parts.push(parent.display().to_string());
        }
        extra_env.push(("OPENCLAW_GATEWAY_BUNDLE_DIR".to_string(), bundle_dir));
        format!(
            "'{}' '{}'",
            sh_single_quote(&node_path),
            sh_single_quote(&entry_point)
        )
    } else {
        let openclaw_path = shell::get_openclaw_path().ok_or_else(|| {
            "OpenClaw CLI is unavailable and bundled runtime could not be found".to_string()
        })?;
        if let Some(parent) = std::path::Path::new(&openclaw_path).parent() {
            path_parts.push(parent.display().to_string());
        }
        format!("'{}'", sh_single_quote(&openclaw_path))
    };

    if let Some(bin_dir) = shell::get_npm_global_bin_dir() {
        if !bin_dir.trim().is_empty() {
            path_parts.push(bin_dir);
        }
    }

    let base_path = shell::get_extended_path();
    if !base_path.trim().is_empty() {
        path_parts.push(base_path);
    }

    let mut env_lines = format!("export PATH='{}'\n", sh_single_quote(&path_parts.join(":")));
    for (key, value) in extra_env {
        env_lines.push_str(&format!("export {}='{}'\n", key, sh_single_quote(&value)));
    }

    Ok((env_lines, launcher))
}

#[cfg(target_os = "windows")]
fn build_windows_whatsapp_login_script(app: &tauri::AppHandle) -> Result<String, String> {
    let mut extended_path = shell::get_extended_path();

    if let Some(bin_dir) = shell::get_npm_global_bin_dir() {
        if !bin_dir.trim().is_empty() {
            extended_path = format!("{};{}", bin_dir, extended_path);
        }
    }

    let mut extra_env: Vec<(String, String)> =
        shell::load_openclaw_env_vars().into_iter().collect();
    extra_env.push((
        "OPENCLAW_GATEWAY_TOKEN".to_string(),
        shell::session_gateway_token().to_string(),
    ));
    extra_env.push(("OPENCLAW_DESKTOP".to_string(), "1".to_string()));
    extra_env.push(("OPENCLAW_NO_RESPAWN".to_string(), "1".to_string()));
    let gm = app.state::<crate::gateway::GatewayManager>();
    let port = gm.get_port();
    extra_env.push(("OPENCLAW_GATEWAY_PORT".to_string(), port.to_string()));
    extra_env.push(("OPENCLAW_STATE_DIR".to_string(), platform::get_config_dir()));

    if let Some(prefix) = shell::get_npm_global_prefix() {
        extra_env.push((
            "NPM_CONFIG_PREFIX".to_string(),
            prefix.to_string_lossy().to_string(),
        ));
    }

    let launcher = if let (Some(node_path), Some((bundle_dir, entry_point))) =
        (shell::get_node_path(), shell::get_bundle_entry())
    {
        if let Some(parent) = std::path::Path::new(&node_path).parent() {
            extended_path = format!("{};{}", parent.display(), extended_path);
        }
        extra_env.push(("OPENCLAW_GATEWAY_BUNDLE_DIR".to_string(), bundle_dir));
        format!(
            "& '{}' '{}'",
            powershell_single_quote(&node_path),
            powershell_single_quote(&entry_point)
        )
    } else {
        let openclaw_path = shell::get_openclaw_path().ok_or_else(|| {
            "OpenClaw CLI is unavailable and bundled runtime could not be found".to_string()
        })?;
        if let Some(parent) = std::path::Path::new(&openclaw_path).parent() {
            extended_path = format!("{};{}", parent.display(), extended_path);
        }
        format!("& '{}'", powershell_single_quote(&openclaw_path))
    };

    let mut env_lines = String::new();
    env_lines.push_str(&format!(
        "$env:PATH = '{}'
",
        powershell_single_quote(&extended_path)
    ));
    for (key, value) in extra_env {
        env_lines.push_str(&format!(
            "$env:{} = '{}'
",
            key,
            powershell_single_quote(&value)
        ));
    }

    Ok(format!(
        r#"$ErrorActionPreference = 'Stop'
{}
Clear-Host
Write-Host '========================================================'
Write-Host '            WhatsApp Login Wizard                       '
Write-Host '========================================================'
Write-Host ''

function Invoke-OpenClaw {{
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
  {} @CliArgs
  if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {{
    throw "openclaw command failed with exit code $LASTEXITCODE"
  }}
}}

try {{
  Write-Host 'Step 1/3: Enable WhatsApp plugin...'
  Invoke-OpenClaw plugins enable whatsapp | Out-Null
  Invoke-OpenClaw config set --strict-json plugins.entries.whatsapp.enabled true | Out-Null
  Invoke-OpenClaw config set channels.whatsapp.dmPolicy pairing | Out-Null
  Invoke-OpenClaw config set channels.whatsapp.groupPolicy allowlist | Out-Null
  Write-Host 'OK: plugin enabled'
  Write-Host ''

  Write-Host 'Step 2/3: Restart gateway...'
  try {{
    Invoke-OpenClaw gateway stop | Out-Null
  }} catch {{
    Write-Host 'Info: gateway was not running, continuing...'
  }}
  Start-Sleep -Seconds 2
  Invoke-OpenClaw gateway start | Out-Null
  Write-Host 'OK: gateway restarted'
  Write-Host ''

  Write-Host 'Step 3/3: Start WhatsApp login...'
  Write-Host 'Scan the QR code with WhatsApp on your phone.'
  Write-Host ''
  Invoke-OpenClaw channels login --channel whatsapp --verbose
  Write-Host ''
  Write-Host 'OK: login flow finished'
}} catch {{
  Write-Host ''
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
}}

Write-Host ''
Read-Host 'Press Enter to close'
"#,
        env_lines, launcher
    ))
}

/// 测试渠道连接（检查状态并发送测试消息）
#[command]
pub async fn test_channel(channel_type: String) -> Result<ChannelTestResult, String> {
    info!("[渠道测试] 测试渠道: {}", channel_type);
    let channel_lower = channel_type.to_lowercase();

    // 使用 openclaw channels status --json 检查渠道状态
    info!("[渠道测试] 步骤1: 检查渠道状态...");
    let status_args = if channel_requires_probe_status(&channel_type) {
        vec!["channels", "status", "--json", "--probe"]
    } else {
        vec!["channels", "status", "--json"]
    };
    let status_result = shell::run_openclaw(&status_args);

    let mut channel_ok = false;
    let mut status_message = String::new();
    let mut debug_info = String::new();
    match &status_result {
        Ok(output) => {
            info!("[渠道测试] status 命令执行成功");
            let clean_output = strip_ansi_codes(output);

            // 使用 JSON 解析
            let mut json_parsed = false;
            if let Some(json_str) = extract_json_from_output(&clean_output) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    if let Some(parsed_status) = parse_channel_status(&json, &channel_type) {
                        json_parsed = true;
                        match evaluate_channel_status(&channel_type, &parsed_status) {
                            ChannelStatusCheck::Ready {
                                status_message: parsed_message,
                            } => {
                                channel_ok = true;
                                status_message = parsed_message;
                            }
                            ChannelStatusCheck::NotConfigured => {
                                info!("[渠道测试] {} 未配置", channel_type);
                                return Ok(ChannelTestResult {
                                    success: false,
                                    channel: channel_type.clone(),
                                    message: format!("{} 未配置", channel_type),
                                    error: Some(format!("请先在消息渠道设置中配置 {} 的凭据并保存，然后重启 Gateway", channel_type)),
                                });
                            }
                            ChannelStatusCheck::NotReady {
                                status_message: parsed_message,
                                error,
                            } => {
                                info!("[渠道测试] {} 状态未就绪: {}", channel_type, parsed_message);
                                return Ok(ChannelTestResult {
                                    success: false,
                                    channel: channel_type.clone(),
                                    message: format!("{} {}", channel_type, parsed_message),
                                    error: Some(error),
                                });
                            }
                        }
                    }
                }
            }

            if !channel_ok && !json_parsed {
                debug_info = format!("无法解析 {} 的状态", channel_type);
                info!("[渠道测试] {}", debug_info);
            }
        }
        Err(e) => {
            debug_info = format!("命令执行失败: {}", e);
            info!("[渠道测试] {}", debug_info);
        }
    }

    // 如果渠道状态不 OK，直接返回失败
    if !channel_ok {
        info!("[渠道测试] {} 状态检查失败，不发送测试消息", channel_type);
        let error_msg = if debug_info.is_empty() {
            "请先在消息渠道设置中配置凭据并保存，然后重启 Gateway".to_string()
        } else {
            debug_info
        };
        return Ok(ChannelTestResult {
            success: false,
            channel: channel_type.clone(),
            message: format!("{} 未连接", channel_type),
            error: Some(error_msg),
        });
    }

    info!("[渠道测试] {} 状态正常 ({})", channel_type, status_message);

    // 对于不支持发送测试消息的渠道，只返回状态检查结果
    if !channel_needs_send_test(&channel_type) {
        info!(
            "[渠道测试] {} 不需要发送测试消息（状态检查即可）",
            channel_type
        );
        return Ok(ChannelTestResult {
            success: true,
            channel: channel_type.clone(),
            message: format!("{} 状态正常 ({})", channel_type, status_message),
            error: None,
        });
    }

    // 尝试发送测试消息
    info!("[渠道测试] 步骤2: 获取测试目标...");
    let test_target = get_channel_test_target(&channel_type);

    if let Some(target) = test_target {
        info!("[渠道测试] 步骤3: 发送测试消息到 {}...", target);
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let message = format!("🤖 OpenClaw 测试消息\n\n✅ 连接成功！\n⏰ {}", timestamp);

        // 使用 openclaw message send 发送测试消息
        info!(
            "[渠道测试] 执行: openclaw message send --channel {} --target {} ...",
            channel_lower, target
        );
        let send_result = shell::run_openclaw(&[
            "message",
            "send",
            "--channel",
            &channel_lower,
            "--target",
            &target,
            "--message",
            &message,
            "--json",
        ]);

        match send_result {
            Ok(output) => {
                info!("[渠道测试] 发送命令输出长度: {}", output.len());

                // 检查发送是否成功
                let send_ok = if let Some(json_str) = extract_json_from_output(&output) {
                    info!("[渠道测试] 提取到 JSON: {}", json_str);
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&json_str) {
                        // 检查各种成功标志
                        let has_ok = json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                        let has_success = json
                            .get("success")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let has_message_id = json.get("messageId").is_some();
                        let has_payload_ok = json
                            .get("payload")
                            .and_then(|p| p.get("ok"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let has_payload_message_id = json
                            .get("payload")
                            .and_then(|p| p.get("messageId"))
                            .is_some();
                        let has_payload_result_message_id = json
                            .get("payload")
                            .and_then(|p| p.get("result"))
                            .and_then(|r| r.get("messageId"))
                            .is_some();

                        info!("[渠道测试] 判断条件: ok={}, success={}, messageId={}, payload.ok={}, payload.messageId={}, payload.result.messageId={}",
                            has_ok, has_success, has_message_id, has_payload_ok, has_payload_message_id, has_payload_result_message_id);

                        has_ok
                            || has_success
                            || has_message_id
                            || has_payload_ok
                            || has_payload_message_id
                            || has_payload_result_message_id
                    } else {
                        info!("[渠道测试] JSON 解析失败");
                        false
                    }
                } else {
                    info!("[渠道测试] 未提取到 JSON，检查关键词");
                    // 如果没有 JSON，检查是否有错误关键词
                    !output.to_lowercase().contains("error")
                        && !output.to_lowercase().contains("failed")
                };

                if send_ok {
                    info!("[渠道测试] ✓ {} 测试消息发送成功", channel_type);
                    Ok(ChannelTestResult {
                        success: true,
                        channel: channel_type.clone(),
                        message: format!("{} 测试消息已发送 ({})", channel_type, status_message),
                        error: None,
                    })
                } else {
                    info!("[渠道测试] ✗ {} 测试消息发送失败", channel_type);
                    Ok(ChannelTestResult {
                        success: false,
                        channel: channel_type.clone(),
                        message: format!("{} 消息发送失败", channel_type),
                        error: Some(output),
                    })
                }
            }
            Err(e) => {
                info!("[渠道测试] ✗ {} 发送命令执行失败: {}", channel_type, e);
                Ok(ChannelTestResult {
                    success: false,
                    channel: channel_type.clone(),
                    message: format!("{} 消息发送失败", channel_type),
                    error: Some(e),
                })
            }
        }
    } else {
        // 没有配置测试目标，返回状态但提示需要配置测试目标
        let hint = match channel_lower.as_str() {
            "telegram" => "请配置 OPENCLAW_TELEGRAM_USERID",
            "discord" => "请配置 OPENCLAW_DISCORD_TESTCHANNELID",
            "slack" => "请配置 OPENCLAW_SLACK_TESTCHANNELID",
            "feishu" => "请配置 OPENCLAW_FEISHU_TESTCHATID",
            _ => "请配置测试目标",
        };

        info!(
            "[渠道测试] {} 未配置测试目标，跳过发送消息 ({})",
            channel_type, hint
        );
        Ok(ChannelTestResult {
            success: true,
            channel: channel_type.clone(),
            message: format!("{} 状态正常 ({}) - {}", channel_type, status_message, hint),
            error: None,
        })
    }
}

/// 获取系统信息
#[command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    info!("[系统信息] 获取系统信息...");
    let os = platform::get_os();
    let arch = platform::get_arch();
    info!("[系统信息] OS: {}, Arch: {}", os, arch);

    // 获取 OS 版本
    let os_version = if platform::is_macos() {
        shell::run_command_output("sw_vers", &["-productVersion"])
            .unwrap_or_else(|_| "unknown".to_string())
    } else if platform::is_linux() {
        shell::run_bash_output("cat /etc/os-release | grep VERSION_ID | cut -d'=' -f2 | tr -d '\"'")
            .unwrap_or_else(|_| "unknown".to_string())
    } else {
        "unknown".to_string()
    };

    let has_bundle = shell::get_bundle_entry().is_some() && shell::get_node_path().is_some();
    let has_global = shell::get_openclaw_path().is_some();
    let openclaw_installed = has_bundle || has_global;
    let openclaw_version = if openclaw_installed {
        shell::run_openclaw(&["--version"]).ok()
    } else {
        None
    };

    let node_version =
        shell::get_node_path().and_then(|p| shell::run_command_output(&p, &["--version"]).ok());

    Ok(SystemInfo {
        os,
        os_version,
        arch,
        openclaw_installed,
        openclaw_version,
        node_version,
        config_dir: platform::get_config_dir(),
    })
}

/// 启动渠道登录（如 WhatsApp 扫码）
#[command]
pub async fn start_channel_login(
    app: tauri::AppHandle,
    channel_type: String,
) -> Result<String, String> {
    info!("[渠道登录] 开始渠道登录流程: {}", channel_type);

    match channel_type.as_str() {
        "whatsapp" => {
            info!("[渠道登录] WhatsApp 登录流程...");
            info!("[渠道登录] 启用 whatsapp 插件...");
            let _ = shell::run_openclaw(&["plugins", "enable", "whatsapp"]);

            #[cfg(target_os = "macos")]
            {
                let env_path = platform::get_env_file_path();
                let (env_lines, launcher) = build_unix_openclaw_launcher(&app)?;
                let script_content = format!(
                    r#"#!/bin/bash
source '{}' 2>/dev/null || true
{}
clear
echo "╔══════════════════════════════════════════════════╗"
echo "║           📱 WhatsApp 登录向导                          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

invoke_openclaw() {{
  {} "$@"
}}

echo "步骤 1/3: 启用 WhatsApp 插件..."
invoke_openclaw plugins enable whatsapp 2>/dev/null || true

# 确保 whatsapp 在 plugins.allow 数组中
python3 << 'PYEOF'
import json
import os

config_path = os.path.expanduser("~/.openclawcn/openclaw.json")
plugin_id = "whatsapp"

try:
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    # 设置 plugins.allow 和 plugins.entries
    if 'plugins' not in config:
        config['plugins'] = {{'allow': [], 'entries': {{}}}}
    if 'allow' not in config['plugins']:
        config['plugins']['allow'] = []
    if 'entries' not in config['plugins']:
        config['plugins']['entries'] = {{}}
    
    if plugin_id not in config['plugins']['allow']:
        config['plugins']['allow'].append(plugin_id)
    
    config['plugins']['entries'][plugin_id] = {{'enabled': True}}
    
    # 确保 channels.whatsapp 存在（但不设置 enabled，WhatsApp 不支持这个键）
    if 'channels' not in config:
        config['channels'] = {{}}
    if plugin_id not in config['channels']:
        config['channels'][plugin_id] = {{'dmPolicy': 'pairing', 'groupPolicy': 'allowlist'}}
    
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print("配置已更新")
except Exception as e:
    print(f"Warning: {{e}}")
PYEOF

echo "✅ 插件已启用"
echo ""

echo "步骤 2/3: 重启 Gateway 使插件生效..."
invoke_openclaw gateway stop 2>/dev/null || true
sleep 2
invoke_openclaw gateway start 2>/dev/null || invoke_openclaw gateway --port $OPENCLAW_GATEWAY_PORT --bind lan &
sleep 3
echo "✅ Gateway 已重启"
echo ""

echo "步骤 3/3: 启动 WhatsApp 登录..."
echo "请使用 WhatsApp 手机 App 扫描下方二维码"
echo ""
invoke_openclaw channels login --channel whatsapp --verbose
echo ""
echo "════════════════════════════════════════════════"
echo "登录完成！"
echo ""
read -p "按回车键关闭此窗口..."
"#,
                    sh_single_quote(&env_path),
                    env_lines,
                    launcher
                );

                let script_path = "/tmp/openclaw_whatsapp_login.command";
                std::fs::write(script_path, script_content)
                    .map_err(|e| format!("创建脚本失败: {}", e))?;

                std::process::Command::new("chmod")
                    .args(["+x", script_path])
                    .output()
                    .map_err(|e| format!("设置权限失败: {}", e))?;

                std::process::Command::new("open")
                    .arg(script_path)
                    .spawn()
                    .map_err(|e| format!("启动终端失败: {}", e))?;
            }

            #[cfg(target_os = "linux")]
            {
                let env_path = platform::get_env_file_path();
                let (env_lines, launcher) = build_unix_openclaw_launcher(&app)?;
                let script_content = format!(
                    r#"#!/bin/bash
source '{}' 2>/dev/null || true
{}
clear
echo "📱 WhatsApp 登录向导"
echo ""
invoke_openclaw() {{
  {} "$@"
}}
invoke_openclaw channels login --channel whatsapp --verbose
echo ""
read -p "按回车键关闭..."
"#,
                    sh_single_quote(&env_path),
                    env_lines,
                    launcher
                );

                let script_path = "/tmp/openclaw_whatsapp_login.sh";
                std::fs::write(script_path, &script_content)
                    .map_err(|e| format!("创建脚本失败: {}", e))?;

                std::process::Command::new("chmod")
                    .args(["+x", script_path])
                    .output()
                    .map_err(|e| format!("设置权限失败: {}", e))?;

                let terminals = ["gnome-terminal", "xfce4-terminal", "konsole", "xterm"];
                let mut launched = false;

                for term in terminals {
                    let result = std::process::Command::new(term)
                        .args(["--", script_path])
                        .spawn();

                    if result.is_ok() {
                        launched = true;
                        break;
                    }
                }

                if !launched {
                    return Err(
                        "无法启动终端，请手动运行: openclaw channels login --channel whatsapp"
                            .to_string(),
                    );
                }
            }

            #[cfg(target_os = "windows")]
            {
                let script_path = std::env::temp_dir().join("openclaw-whatsapp-login.ps1");
                let script_content = build_windows_whatsapp_login_script(&app)?;

                std::fs::write(&script_path, script_content)
                    .map_err(|e| format!("Failed to create PowerShell script: {}", e))?;

                std::process::Command::new("powershell.exe")
                    .args([
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-Command",
                        &format!(
                            "Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','{}'",
                            script_path.display().to_string().replace('\\', "\\\\")
                        ),
                    ])
                    .spawn()
                    .map_err(|e| format!("Failed to launch PowerShell terminal: {}", e))?;
            }

            Ok("已启动 WhatsApp 登录终端".to_string())
        }
        _ => Err(format!("不支持 {} 的登录向导", channel_type)),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_ai_probe_args, channel_needs_send_test, channel_requires_connected_status,
        channel_requires_linked_status, channel_requires_probe_status,
        channel_requires_running_status, clean_ai_test_output, detect_ai_test_error,
        evaluate_channel_status, extract_provider_from_model_ref, format_provider_model_ref,
        parse_ai_probe_result, parse_channel_status, ChannelStatusCheck,
    };
    use serde_json::json;

    #[test]
    fn only_whatsapp_requires_linked_status() {
        assert!(channel_requires_linked_status("whatsapp"));
        assert!(!channel_requires_linked_status("telegram"));
    }

    #[test]
    fn only_direct_send_channels_require_test_targets() {
        assert!(channel_needs_send_test("telegram"));
        assert!(channel_needs_send_test("discord"));
        assert!(channel_needs_send_test("slack"));
        assert!(channel_needs_send_test("feishu"));
        assert!(!channel_needs_send_test("whatsapp"));
        assert!(!channel_needs_send_test("imessage"));
        assert!(!channel_needs_send_test("wecom"));
        assert!(!channel_needs_send_test("dingtalk"));
        assert!(!channel_needs_send_test("qqbot"));
    }

    #[test]
    fn only_imessage_requires_status_probe() {
        assert!(channel_requires_probe_status("imessage"));
        assert!(!channel_requires_probe_status("whatsapp"));
        assert!(!channel_requires_probe_status("dingtalk"));
    }

    #[test]
    fn runtime_required_channels_are_limited_to_dingtalk_and_qqbot() {
        assert!(channel_requires_running_status("dingtalk"));
        assert!(channel_requires_running_status("qqbot"));
        assert!(channel_requires_connected_status("qqbot"));
        assert!(!channel_requires_running_status("wecom"));
        assert!(!channel_requires_connected_status("dingtalk"));
    }

    #[test]
    fn parse_channel_status_prefers_default_account_snapshot() {
        let payload = json!({
            "channels": {
                "qqbot": {
                    "configured": true
                }
            },
            "channelDefaultAccountId": {
                "qqbot": "work"
            },
            "channelAccounts": {
                "qqbot": [
                    {
                        "accountId": "default",
                        "configured": true,
                        "running": false,
                        "connected": false
                    },
                    {
                        "accountId": "work",
                        "configured": true,
                        "running": true,
                        "connected": true
                    }
                ]
            }
        });

        let parsed = parse_channel_status(&payload, "qqbot").expect("qqbot status");
        assert_eq!(parsed.running, Some(true));
        assert_eq!(parsed.connected, Some(true));
    }

    #[test]
    fn whatsapp_requires_linked_session() {
        let payload = json!({
            "channels": {
                "whatsapp": {
                    "configured": true,
                    "linked": false
                }
            }
        });

        let parsed = parse_channel_status(&payload, "whatsapp").expect("whatsapp status");
        assert_eq!(
            evaluate_channel_status("whatsapp", &parsed),
            ChannelStatusCheck::NotReady {
                status_message: "等待扫码登录".to_string(),
                error: "请先扫码登录 whatsapp，然后重试".to_string(),
            }
        );
    }

    #[test]
    fn imessage_requires_probe_success() {
        let payload = json!({
            "channels": {
                "imessage": {
                    "configured": true,
                    "probe": {
                        "ok": false,
                        "error": "imsg not found"
                    }
                }
            }
        });

        let parsed = parse_channel_status(&payload, "imessage").expect("imessage status");
        assert_eq!(
            evaluate_channel_status("imessage", &parsed),
            ChannelStatusCheck::NotReady {
                status_message: "探测失败".to_string(),
                error: "imsg not found".to_string(),
            }
        );
    }

    #[test]
    fn dingtalk_requires_running_gateway_state() {
        let payload = json!({
            "channels": {
                "dingtalk": {
                    "configured": true
                }
            },
            "channelAccounts": {
                "dingtalk": [
                    {
                        "accountId": "default",
                        "configured": true,
                        "running": false,
                        "lastError": "Connection failed"
                    }
                ]
            }
        });

        let parsed = parse_channel_status(&payload, "dingtalk").expect("dingtalk status");
        assert_eq!(
            evaluate_channel_status("dingtalk", &parsed),
            ChannelStatusCheck::NotReady {
                status_message: "未运行".to_string(),
                error: "Connection failed".to_string(),
            }
        );
    }

    #[test]
    fn qqbot_requires_connected_runtime_state() {
        let payload = json!({
            "channels": {
                "qqbot": {
                    "configured": true
                }
            },
            "channelAccounts": {
                "qqbot": [
                    {
                        "accountId": "default",
                        "configured": true,
                        "running": true,
                        "connected": false,
                        "lastError": "Gateway disconnected"
                    }
                ]
            }
        });

        let parsed = parse_channel_status(&payload, "qqbot").expect("qqbot status");
        assert_eq!(
            evaluate_channel_status("qqbot", &parsed),
            ChannelStatusCheck::NotReady {
                status_message: "已启动但未连接".to_string(),
                error: "Gateway disconnected".to_string(),
            }
        );
    }

    #[test]
    fn wecom_can_still_pass_with_configuration_only() {
        let payload = json!({
            "channels": {
                "wecom": {
                    "configured": true
                }
            }
        });

        let parsed = parse_channel_status(&payload, "wecom").expect("wecom status");
        assert_eq!(
            evaluate_channel_status("wecom", &parsed),
            ChannelStatusCheck::Ready {
                status_message: "已配置".to_string(),
            }
        );
    }

    #[test]
    fn extracts_provider_from_model_ref() {
        assert_eq!(
            extract_provider_from_model_ref("onestop/kimi-k2.5"),
            Some("onestop".to_string())
        );
        assert_eq!(extract_provider_from_model_ref(""), None);
        assert_eq!(extract_provider_from_model_ref("no-slash"), None);
    }

    #[test]
    fn cleans_ai_test_output_and_strips_warnings() {
        let output = r#"
ExperimentalWarning: something noisy

  OPENCLAW-DESKTOP-CONNECT-OK  
"#;

        assert_eq!(clean_ai_test_output(output), "OPENCLAW-DESKTOP-CONNECT-OK");
    }

    #[test]
    fn detects_known_ai_test_errors() {
        let output = "API error: invalid api key";
        assert_eq!(detect_ai_test_error(output).as_deref(), Some(output));
    }

    #[test]
    fn build_ai_probe_args_use_models_status_probe_path() {
        let args = build_ai_probe_args(Some("onestop"), Some("onestop/kimi-k2.5"));

        assert_eq!(args[0], "models");
        assert_eq!(args[1], "status");
        assert!(args.iter().any(|arg| arg == "--json"));
        assert!(args.iter().any(|arg| arg == "--probe"));
        assert!(args.iter().any(|arg| arg == "--probe-provider"));
        assert!(args.iter().any(|arg| arg == "--probe-model"));
        let provider_index = args
            .iter()
            .position(|arg| arg == "--probe-provider")
            .expect("provider index");
        assert_eq!(args[provider_index + 1], "onestop");
        let model_index = args
            .iter()
            .position(|arg| arg == "--probe-model")
            .expect("model index");
        assert_eq!(args[model_index + 1], "onestop/kimi-k2.5");
    }

    #[test]
    fn formats_provider_model_ref_with_provider_prefix() {
        assert_eq!(
            format_provider_model_ref(Some("onestop"), Some("kimi-k2.5"), "default"),
            "onestop/kimi-k2.5"
        );
        assert_eq!(
            format_provider_model_ref(Some("onestop"), Some("onestop/kimi-k2.5"), "default"),
            "onestop/kimi-k2.5"
        );
        assert_eq!(
            format_provider_model_ref(None, Some("kimi-k2.5"), "default"),
            "kimi-k2.5"
        );
    }

    #[test]
    fn parses_successful_ai_probe_result() {
        let result = parse_ai_probe_result(
            r#"{
  "auth": {
    "probes": {
      "results": [
        {
          "provider": "onestop",
          "model": "onestop/kimi-k2.5",
          "status": "ok",
          "latencyMs": 912
        }
      ]
    }
  }
}"#,
            Some("onestop"),
            "onestop/kimi-k2.5",
            None,
            4567,
        );

        assert!(result.success);
        assert_eq!(result.provider, "onestop");
        assert_eq!(result.model, "onestop/kimi-k2.5");
        assert_eq!(result.latency_ms, Some(912));
        assert_eq!(result.response.as_deref(), Some("Probe OK"));
        assert!(result.error.is_none());
    }

    #[test]
    fn parses_failed_ai_probe_result() {
        let result = parse_ai_probe_result(
            r#"{
  "auth": {
    "probes": {
      "results": [
        {
          "provider": "onestop",
          "model": "onestop/kimi-k2.5",
          "status": "timeout",
          "error": "request timed out after 8000ms",
          "latencyMs": 8005
        }
      ]
    }
  }
}"#,
            Some("onestop"),
            "onestop/kimi-k2.5",
            None,
            34,
        );

        assert!(!result.success);
        assert_eq!(
            result.error.as_deref(),
            Some("request timed out after 8000ms")
        );
        assert!(result.response.is_none());
        assert_eq!(result.latency_ms, Some(8005));
    }

    #[test]
    fn parse_ai_probe_result_prefers_selected_profile() {
        let result = parse_ai_probe_result(
            r#"{
  "auth": {
    "probes": {
      "results": [
        {
          "provider": "onestop",
          "profileId": "onestop:stale",
          "model": "onestop/kimi-k2.5",
          "status": "unknown",
          "error": "Excluded by auth.order for this provider."
        },
        {
          "provider": "onestop",
          "profileId": "onestop:default",
          "model": "onestop/kimi-k2.5",
          "status": "ok",
          "latencyMs": 640
        }
      ]
    }
  }
}"#,
            Some("onestop"),
            "onestop/kimi-k2.5",
            Some("onestop:default"),
            1000,
        );

        assert!(result.success);
        assert_eq!(result.latency_ms, Some(640));
    }

    #[test]
    fn parse_ai_probe_result_prefers_selected_model() {
        let result = parse_ai_probe_result(
            r#"{
  "auth": {
    "probes": {
      "results": [
        {
          "provider": "onestop",
          "model": "onestop/old-model",
          "status": "ok",
          "latencyMs": 400
        },
        {
          "provider": "onestop",
          "model": "onestop/kimi-k2.5",
          "status": "timeout",
          "error": "request timed out after 8000ms",
          "latencyMs": 8001
        }
      ]
    }
  }
}"#,
            Some("onestop"),
            "onestop/kimi-k2.5",
            None,
            1000,
        );

        assert!(!result.success);
        assert_eq!(result.model, "onestop/kimi-k2.5");
        assert_eq!(
            result.error.as_deref(),
            Some("request timed out after 8000ms")
        );
    }
}
