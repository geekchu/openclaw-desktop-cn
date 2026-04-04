use crate::models::{
    AIConfigOverview, ChannelConfig, ConfiguredModel, ConfiguredProvider, ModelConfig,
    ModelCostConfig, OfficialProvider, SuggestedModel,
};
use crate::utils::{file, platform, shell};
use log::{debug, error, info, warn};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{command, AppHandle, Manager};

fn desktop_supported_channel_types() -> Vec<(&'static str, &'static str, Vec<&'static str>)> {
    vec![
        ("telegram", "telegram", vec!["userId"]),
        ("discord", "discord", vec!["testChannelId"]),
        ("slack", "slack", vec!["testChannelId"]),
        ("feishu", "feishu", vec!["testChatId"]),
        ("whatsapp", "whatsapp", vec![]),
        ("imessage", "imessage", vec![]),
        ("wecom", "wecom", vec![]),
        ("dingtalk", "dingtalk", vec![]),
        ("qqbot", "qqbot", vec![]),
    ]
}

fn builtin_channel_plugin_ids() -> Vec<&'static str> {
    vec![
        "telegram",
        "discord",
        "slack",
        "feishu",
        "dingtalk",
        "wecom",
        "qqbot",
        "whatsapp",
        "imessage",
        "signal",
        "line",
        "matrix",
        "msteams",
        "googlechat",
        "mattermost",
        "irc",
        "nostr",
        "zalo",
        "zalouser",
        "tlon",
        "twitch",
        "bluebubbles",
        "nextcloud-talk",
    ]
}

fn is_test_only_channel_field(field: &str) -> bool {
    matches!(field, "userId" | "testChatId" | "testChannelId")
}

fn has_meaningful_channel_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(boolean) => *boolean,
        Value::Number(_) => true,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => items.iter().any(has_meaningful_channel_value),
        Value::Object(map) => map.iter().any(|(key, item)| {
            key != "enabled"
                && !is_test_only_channel_field(key)
                && has_meaningful_channel_value(item)
        }),
    }
}

fn channel_has_persisted_config(channel_config: Option<&Value>) -> bool {
    channel_config.is_some_and(has_meaningful_channel_value)
}

fn is_placeholder_channel_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Array(items) => items.is_empty() || items.iter().all(is_placeholder_channel_value),
        Value::Object(map) => {
            map.is_empty()
                || map.iter().all(|(key, item)| {
                    key == "enabled"
                        || is_test_only_channel_field(key)
                        || is_placeholder_channel_value(item)
                })
        }
        Value::Bool(_) | Value::Number(_) => false,
    }
}

fn normalize_desktop_channel_value(value: &mut Value) -> usize {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.len() != text.len() {
                *text = trimmed.to_string();
                return 1;
            }
            0
        }
        Value::Array(items) => {
            let mut changed = 0;
            for item in items.iter_mut() {
                changed += normalize_desktop_channel_value(item);
            }
            let before_len = items.len();
            items.retain(|item| !is_placeholder_channel_value(item));
            if items.len() != before_len {
                changed += before_len - items.len();
            }
            changed
        }
        Value::Object(map) => {
            let mut changed = 0;
            for item in map.values_mut() {
                changed += normalize_desktop_channel_value(item);
            }
            let keys_to_remove: Vec<String> = map
                .iter()
                .filter(|(key, item)| {
                    key.as_str() != "enabled" && is_placeholder_channel_value(item)
                })
                .map(|(key, _)| key.clone())
                .collect();
            changed += keys_to_remove.len();
            for key in keys_to_remove {
                map.remove(&key);
            }
            changed
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => 0,
    }
}

fn preserve_empty_desktop_channel_presence(channel_id: &str) -> bool {
    matches!(channel_id, "whatsapp" | "imessage")
}

fn should_persist_desktop_channel_config(channel_id: &str, channel_config: &Value) -> bool {
    has_meaningful_channel_value(channel_config)
        || preserve_empty_desktop_channel_presence(channel_id)
}

fn repair_invalid_desktop_channel_configs(config: &mut Value) -> usize {
    let Some(channels) = config
        .get_mut("channels")
        .and_then(|value| value.as_object_mut())
    else {
        return 0;
    };

    let supported_ids: Vec<&str> = desktop_supported_channel_types()
        .into_iter()
        .map(|(channel_id, _, _)| channel_id)
        .collect();

    let mut changed = 0;
    let mut channels_to_remove = Vec::new();

    for channel_id in supported_ids {
        let Some(channel_value) = channels.get_mut(channel_id) else {
            continue;
        };

        if !channel_value.is_object() {
            info!(
                "[配置初始化] 移除畸形的 channels.{} 配置（必须为对象）",
                channel_id
            );
            channels_to_remove.push(channel_id.to_string());
            continue;
        }

        changed += normalize_desktop_channel_value(channel_value);

        if channel_id == "wecom" {
            if let Some(channel_obj) = channel_value.as_object_mut() {
                let should_remove_aes = channel_obj
                    .get("encodingAesKey")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value.len() != 43);
                if should_remove_aes {
                    warn!(
                        "[配置初始化] 移除无效的 channels.wecom.encodingAesKey，避免启动校验失败"
                    );
                    channel_obj.remove("encodingAesKey");
                    changed += 1;
                }
            }
        }

        if !channel_has_persisted_config(Some(channel_value)) {
            if preserve_empty_desktop_channel_presence(channel_id) {
                info!(
                    "[配置初始化] 保留空的 channels.{} 占位对象，维持渠道默认运行语义",
                    channel_id
                );
                continue;
            }
            info!(
                "[配置初始化] 移除空的 channels.{} 占位配置，避免历史残留阻塞启动",
                channel_id
            );
            channels_to_remove.push(channel_id.to_string());
        }
    }

    for channel_id in channels_to_remove {
        channels.remove(&channel_id);
        changed += 1;
    }

    changed
}

/// 获取 openclaw.json 配置
fn load_openclaw_config() -> Result<Value, String> {
    let config_path = platform::get_config_file_path();

    if !file::file_exists(&config_path) {
        return Ok(json!({}));
    }

    let content = file::read_file(&config_path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))
}

/// 保存 openclaw.json 配置
fn save_openclaw_config(config: &Value) -> Result<(), String> {
    let config_path = platform::get_config_file_path();

    let content =
        serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {}", e))?;

    file::write_file(&config_path, &content).map_err(|e| format!("写入配置文件失败: {}", e))
}

fn summarize_provider_api_key(api_key_value: Option<&Value>) -> (Option<String>, bool) {
    match api_key_value {
        Some(Value::String(key)) if !key.trim().is_empty() => {
            let masked = if key.len() > 8 {
                format!("{}...{}", &key[..4], &key[key.len() - 4..])
            } else {
                "****".to_string()
            };
            (Some(masked), true)
        }
        Some(Value::Object(map)) if !map.is_empty() => (Some("已配置引用".to_string()), true),
        _ => (None, false),
    }
}

fn merge_model_config(existing_model: Option<&Value>, model: &ModelConfig) -> Value {
    let mut model_obj = existing_model.cloned().unwrap_or_else(|| json!({}));
    if !model_obj.is_object() {
        model_obj = json!({});
    }

    model_obj["id"] = json!(model.id);
    model_obj["name"] = json!(model.name);

    if let Some(api) = &model.api {
        model_obj["api"] = json!(api);
    }

    if !model.input.is_empty() {
        model_obj["input"] = json!(model.input);
    }

    if let Some(cw) = model.context_window {
        model_obj["contextWindow"] = json!(cw);
    }
    if let Some(mt) = model.max_tokens {
        model_obj["maxTokens"] = json!(mt);
    }
    if let Some(reasoning) = model.reasoning {
        model_obj["reasoning"] = json!(reasoning);
    }
    if let Some(cost) = &model.cost {
        model_obj["cost"] = json!({
            "input": cost.input,
            "output": cost.output,
            "cacheRead": cost.cache_read,
            "cacheWrite": cost.cache_write,
        });
    }

    model_obj
}

fn build_merged_provider_config(
    existing_provider: Option<&Value>,
    base_url: &str,
    api_key: Option<String>,
    api_type: &str,
    models: &[ModelConfig],
) -> Value {
    let mut provider_config = existing_provider.cloned().unwrap_or_else(|| json!({}));
    if !provider_config.is_object() {
        provider_config = json!({});
    }

    let existing_models = existing_provider
        .and_then(|provider| provider.get("models"))
        .and_then(|value| value.as_array());

    let models_json: Vec<Value> = models
        .iter()
        .map(|model| {
            let existing_model = existing_models.and_then(|items| {
                items.iter().find(|item| {
                    item.get("id")
                        .and_then(|value| value.as_str())
                        .is_some_and(|id| id == model.id)
                })
            });
            merge_model_config(existing_model, model)
        })
        .collect();

    provider_config["baseUrl"] = json!(base_url);
    provider_config["api"] = json!(api_type);
    provider_config["models"] = json!(models_json);

    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            provider_config["apiKey"] = json!(key);
        } else if let Some(existing_key) =
            existing_provider.and_then(|provider| provider.get("apiKey"))
        {
            provider_config["apiKey"] = existing_key.clone();
        } else if let Some(provider_obj) = provider_config.as_object_mut() {
            provider_obj.remove("apiKey");
        }
    } else if let Some(existing_key) = existing_provider.and_then(|provider| provider.get("apiKey"))
    {
        provider_config["apiKey"] = existing_key.clone();
    } else if let Some(provider_obj) = provider_config.as_object_mut() {
        provider_obj.remove("apiKey");
    }

    provider_config
}

fn sync_provider_default_model_entries(
    config: &mut Value,
    provider_name: &str,
    models: &[ModelConfig],
) {
    let Some(defaults_models) = config["agents"]["defaults"]["models"].as_object_mut() else {
        return;
    };

    let prefix = format!("{}/", provider_name);
    let desired_keys: std::collections::HashSet<String> = models
        .iter()
        .map(|model| format!("{}/{}", provider_name, model.id))
        .collect();

    let old_keys: Vec<String> = defaults_models
        .keys()
        .filter(|key| key.starts_with(&prefix) && !desired_keys.contains(*key))
        .cloned()
        .collect();
    for key in old_keys {
        defaults_models.remove(&key);
    }

    for full_id in desired_keys {
        defaults_models.entry(full_id).or_insert_with(|| json!({}));
    }
}

fn clear_primary_model_if_removed(config: &mut Value, provider_name: &str, models: &[ModelConfig]) {
    let Some(primary_model) = config
        .pointer("/agents/defaults/model/primary")
        .and_then(|value| value.as_str())
    else {
        return;
    };

    let desired_keys: std::collections::HashSet<String> = models
        .iter()
        .map(|model| format!("{}/{}", provider_name, model.id))
        .collect();
    if !primary_model.starts_with(&format!("{}/", provider_name))
        || desired_keys.contains(primary_model)
    {
        return;
    }

    if let Some(model_obj) = config
        .pointer_mut("/agents/defaults/model")
        .and_then(|value| value.as_object_mut())
    {
        model_obj.remove("primary");
    }
}

fn touch_config_meta(config: &mut Value) {
    if config.get("meta").is_none() {
        config["meta"] = json!({});
    }
    config["meta"]["lastTouchedAt"] = json!(chrono::Utc::now().to_rfc3339());
}

fn parse_model_cost_config(cost_value: Option<&Value>) -> Option<ModelCostConfig> {
    let cost = cost_value?.as_object()?;
    let input = cost.get("input").and_then(|value| value.as_f64());
    let output = cost.get("output").and_then(|value| value.as_f64());
    let cache_read = cost.get("cacheRead").and_then(|value| value.as_f64());
    let cache_write = cost.get("cacheWrite").and_then(|value| value.as_f64());

    if input.is_none() && output.is_none() && cache_read.is_none() && cache_write.is_none() {
        return None;
    }

    Some(ModelCostConfig {
        input: input.unwrap_or(0.0),
        output: output.unwrap_or(0.0),
        cache_read: cache_read.unwrap_or(0.0),
        cache_write: cache_write.unwrap_or(0.0),
    })
}

/// 获取完整配置
#[command]
pub async fn get_config() -> Result<Value, String> {
    info!("[获取配置] 读取 openclaw.json 配置...");
    let result = load_openclaw_config();
    match &result {
        Ok(_) => info!("[获取配置] ✓ 配置读取成功"),
        Err(e) => error!("[获取配置] ✗ 配置读取失败: {}", e),
    }
    result
}

/// 深度合并 JSON 对象（递归合并嵌套对象，防止覆盖丢失）
fn deep_merge_config(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            for (k, v) in patch_map {
                if v.is_null() {
                    // null patch value = delete the key from base
                    base_map.remove(k);
                } else {
                    let entry = base_map.entry(k.clone()).or_insert(json!(null));
                    deep_merge_config(entry, v);
                }
            }
        }
        (base, patch) => {
            *base = patch.clone();
        }
    }
}

/// 保存配置
#[command]
pub async fn save_config(config: Value) -> Result<String, String> {
    info!("[保存配置] 保存 openclaw.json 配置...");

    // 验证：必须是 JSON Object
    if !config.is_object() {
        return Err("配置格式无效：必须是 JSON 对象".to_string());
    }

    // 已知顶级 key (未知 key 仅 warn，不拒绝，保持扩展性)
    let known_keys: &[&str] = &[
        "gateway",
        "agents",
        "models",
        "channels",
        "plugins",
        "meta",
        "hooks",
        "security",
        "notifications",
        "web",
        "tools",
        "auth",
        "commands",
        "messages",
        "wizard",
        "proxy",
    ];
    if let Some(obj) = config.as_object() {
        for key in obj.keys() {
            if !known_keys.contains(&key.as_str()) {
                warn!("[保存配置] 未知顶级 key: {}", key);
            }
        }
    }

    debug!(
        "[保存配置] 配置内容: {}",
        serde_json::to_string_pretty(&config).unwrap_or_default()
    );

    // 先读取现有配置，然后深度合并新配置（防止覆盖丢失其他配置项）
    let mut existing = load_openclaw_config().unwrap_or_else(|_| json!({}));
    deep_merge_config(&mut existing, &config);

    match save_openclaw_config(&existing) {
        Ok(_) => {
            info!("[保存配置] ✓ 配置保存成功");
            Ok("配置已保存".to_string())
        }
        Err(e) => {
            error!("[保存配置] ✗ 配置保存失败: {}", e);
            Err(e)
        }
    }
}

/// 获取 exec-approvals.json 内容
#[command]
pub async fn get_exec_approvals() -> Result<Value, String> {
    let path = platform::get_exec_approvals_path();
    if !file::file_exists(&path) {
        return Ok(json!({}));
    }
    let content =
        file::read_file(&path).map_err(|e| format!("读取 exec-approvals.json 失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析 exec-approvals.json 失败: {}", e))
}

/// 保存 exec-approvals.json 内容
#[command]
pub async fn save_exec_approvals(data: Value) -> Result<String, String> {
    let path = platform::get_exec_approvals_path();
    let content = serde_json::to_string_pretty(&data).map_err(|e| format!("序列化失败: {}", e))?;
    file::write_file(&path, &content)
        .map_err(|e| format!("写入 exec-approvals.json 失败: {}", e))?;
    Ok("exec-approvals.json 已保存".to_string())
}

/// 获取环境变量值
#[command]
pub async fn get_env_value(key: String) -> Result<Option<String>, String> {
    info!("[获取环境变量] 读取环境变量: {}", key);
    let env_path = platform::get_env_file_path();
    let value = file::read_env_value(&env_path, &key);
    match &value {
        Some(v) => debug!(
            "[获取环境变量] {}={} (已脱敏)",
            key,
            if v.len() > 8 { "***" } else { v }
        ),
        None => debug!("[获取环境变量] {} 不存在", key),
    }
    Ok(value)
}

/// 保存环境变量值
#[command]
pub async fn save_env_value(key: String, value: String) -> Result<String, String> {
    info!("[保存环境变量] 保存环境变量: {}", key);

    // key 验证：只允许大写字母开头，字母数字下划线
    if !key
        .chars()
        .next()
        .map(|c| c.is_ascii_uppercase())
        .unwrap_or(false)
        || !key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return Err("环境变量名无效：必须以大写字母开头，仅允许大写字母、数字和下划线".to_string());
    }

    // value 验证：拒绝换行符和控制字符
    if value
        .chars()
        .any(|c| c == '\n' || c == '\r' || (c.is_control() && c != '\t'))
    {
        return Err("环境变量值无效：不允许包含换行符或控制字符".to_string());
    }

    let env_path = platform::get_env_file_path();
    debug!("[保存环境变量] 环境文件路径: {}", env_path);

    match file::set_env_value(&env_path, &key, &value) {
        Ok(_) => {
            info!("[保存环境变量] ✓ 环境变量 {} 保存成功", key);
            Ok("环境变量已保存".to_string())
        }
        Err(e) => {
            error!("[保存环境变量] ✗ 保存失败: {}", e);
            Err(format!("保存环境变量失败: {}", e))
        }
    }
}

// ============ Gateway Token 命令 ============

/// 生成加密安全的随机 token (64 字符 hex)
fn generate_token() -> String {
    use rand::Rng;
    let bytes: [u8; 32] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 获取或生成 Gateway Token
#[command]
pub async fn get_or_create_gateway_token() -> Result<String, String> {
    info!("[Gateway Token] 获取或创建 Gateway Token...");

    let mut config = load_openclaw_config()?;

    // 检查是否已有 token
    if let Some(token) = config
        .pointer("/gateway/auth/token")
        .and_then(|v| v.as_str())
    {
        if !token.is_empty() {
            info!("[Gateway Token] ✓ 使用现有 Token");
            return Ok(token.to_string());
        }
    }

    // 生成新 token
    let new_token = generate_token();
    info!("[Gateway Token] 生成新 Token: {}...", &new_token[..8]);

    // 确保路径存在
    if config.get("gateway").is_none() {
        config["gateway"] = json!({});
    }
    if config["gateway"].get("auth").is_none() {
        config["gateway"]["auth"] = json!({});
    }

    // 设置 token
    config["gateway"]["auth"]["token"] = json!(new_token);
    config["gateway"]["mode"] = json!("local");

    // 保存配置
    save_openclaw_config(&config)?;

    info!("[Gateway Token] ✓ Token 已保存到配置");
    Ok(new_token)
}

/// 获取 Dashboard URL（带 token）
#[command]
pub async fn get_dashboard_url(app: AppHandle) -> Result<String, String> {
    info!("[Dashboard URL] 获取 Dashboard URL...");

    let gm = app.state::<crate::gateway::GatewayManager>();
    let port = gm.get_port();
    let token = get_or_create_gateway_token().await?;
    let url = format!("http://localhost:{}?token={}", port, token);

    info!("[Dashboard URL] ✓ URL: {}...", &url[..50.min(url.len())]);
    Ok(url)
}

// ============ AI 配置相关命令 ============

/// 获取官方 Provider 列表（预设模板）
#[command]
pub async fn get_official_providers() -> Result<Vec<OfficialProvider>, String> {
    info!("[官方 Provider] 获取官方 Provider 预设列表...");

    let providers = vec![
        OfficialProvider {
            id: "anthropic".to_string(),
            name: "Anthropic Claude".to_string(),
            icon: "🟣".to_string(),
            default_base_url: Some("https://api.anthropic.com".to_string()),
            api_type: "anthropic-messages".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/anthropic".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "claude-opus-4-5-20251101".to_string(),
                    name: "Claude Opus 4.5".to_string(),
                    description: Some("最强大版本，适合复杂任务".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "claude-sonnet-4-5-20250929".to_string(),
                    name: "Claude Sonnet 4.5".to_string(),
                    description: Some("平衡版本，性价比高".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            icon: "🟢".to_string(),
            default_base_url: Some("https://api.openai.com/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/openai".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    description: Some("最新多模态模型".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(4096),
                    recommended: true,
                },
                SuggestedModel {
                    id: "gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini".to_string(),
                    description: Some("快速经济版".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(4096),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "moonshot".to_string(),
            name: "Moonshot".to_string(),
            icon: "🌙".to_string(),
            default_base_url: Some("https://api.moonshot.cn/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/moonshot".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "kimi-k2.5".to_string(),
                    name: "Kimi K2.5".to_string(),
                    description: Some("最新旗舰模型".to_string()),
                    context_window: Some(200000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "moonshot-v1-128k".to_string(),
                    name: "Moonshot 128K".to_string(),
                    description: Some("超长上下文".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "qwen".to_string(),
            name: "Qwen (通义千问)".to_string(),
            icon: "🔮".to_string(),
            default_base_url: Some("https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/qwen".to_string()),
            suggested_models: vec![
                SuggestedModel {
                    id: "qwen-max".to_string(),
                    name: "Qwen Max".to_string(),
                    description: Some("最强大版本".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "qwen-plus".to_string(),
                    name: "Qwen Plus".to_string(),
                    description: Some("平衡版本".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            icon: "🔵".to_string(),
            default_base_url: Some("https://api.deepseek.com".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: None,
            suggested_models: vec![
                SuggestedModel {
                    id: "deepseek-chat".to_string(),
                    name: "DeepSeek V3".to_string(),
                    description: Some("最新对话模型".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: true,
                },
                SuggestedModel {
                    id: "deepseek-reasoner".to_string(),
                    name: "DeepSeek R1".to_string(),
                    description: Some("推理增强模型".to_string()),
                    context_window: Some(128000),
                    max_tokens: Some(8192),
                    recommended: false,
                },
            ],
        },
        OfficialProvider {
            id: "glm".to_string(),
            name: "GLM (智谱)".to_string(),
            icon: "🔷".to_string(),
            default_base_url: Some("https://open.bigmodel.cn/api/paas/v4".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/glm".to_string()),
            suggested_models: vec![SuggestedModel {
                id: "glm-4".to_string(),
                name: "GLM-4".to_string(),
                description: Some("最新旗舰模型".to_string()),
                context_window: Some(128000),
                max_tokens: Some(8192),
                recommended: true,
            }],
        },
        OfficialProvider {
            id: "minimax".to_string(),
            name: "MiniMax".to_string(),
            icon: "🟡".to_string(),
            default_base_url: Some("https://api.minimaxi.com/anthropic".to_string()),
            api_type: "anthropic-messages".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/minimax".to_string()),
            suggested_models: vec![SuggestedModel {
                id: "minimax-m2.1".to_string(),
                name: "MiniMax M2.1".to_string(),
                description: Some("最新模型".to_string()),
                context_window: Some(200000),
                max_tokens: Some(8192),
                recommended: true,
            }],
        },
        OfficialProvider {
            id: "venice".to_string(),
            name: "Venice AI".to_string(),
            icon: "🏛️".to_string(),
            default_base_url: Some("https://api.venice.ai/api/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/venice".to_string()),
            suggested_models: vec![SuggestedModel {
                id: "llama-3.3-70b".to_string(),
                name: "Llama 3.3 70B".to_string(),
                description: Some("隐私优先推理".to_string()),
                context_window: Some(128000),
                max_tokens: Some(8192),
                recommended: true,
            }],
        },
        OfficialProvider {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            icon: "🔄".to_string(),
            default_base_url: Some("https://openrouter.ai/api/v1".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: true,
            docs_url: Some("https://docs.openclaw.ai/providers/openrouter".to_string()),
            suggested_models: vec![SuggestedModel {
                id: "anthropic/claude-opus-4-5".to_string(),
                name: "Claude Opus 4.5".to_string(),
                description: Some("通过 OpenRouter 访问".to_string()),
                context_window: Some(200000),
                max_tokens: Some(8192),
                recommended: true,
            }],
        },
        OfficialProvider {
            id: "ollama".to_string(),
            name: "Ollama (本地)".to_string(),
            icon: "🟠".to_string(),
            default_base_url: Some("http://localhost:11434".to_string()),
            api_type: "openai-completions".to_string(),
            requires_api_key: false,
            docs_url: Some("https://docs.openclaw.ai/providers/ollama".to_string()),
            suggested_models: vec![SuggestedModel {
                id: "llama3".to_string(),
                name: "Llama 3".to_string(),
                description: Some("本地运行".to_string()),
                context_window: Some(8192),
                max_tokens: Some(4096),
                recommended: true,
            }],
        },
    ];

    info!(
        "[官方 Provider] ✓ 返回 {} 个官方 Provider 预设",
        providers.len()
    );
    Ok(providers)
}

/// 获取 AI 配置概览
#[command]
pub async fn get_ai_config() -> Result<AIConfigOverview, String> {
    info!("[AI 配置] 获取 AI 配置概览...");

    let config_path = platform::get_config_file_path();
    info!("[AI 配置] 配置文件路径: {}", config_path);

    let config = load_openclaw_config()?;
    debug!(
        "[AI 配置] 配置内容: {}",
        serde_json::to_string_pretty(&config).unwrap_or_default()
    );

    // 解析主模型
    let primary_model = config
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    info!("[AI 配置] 主模型: {:?}", primary_model);

    // 解析可用模型列表
    let available_models: Vec<String> = config
        .pointer("/agents/defaults/models")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default();
    info!("[AI 配置] 可用模型数: {}", available_models.len());

    // 解析已配置的 Provider
    let mut configured_providers: Vec<ConfiguredProvider> = Vec::new();

    let providers_value = config.pointer("/models/providers");
    info!(
        "[AI 配置] providers 节点存在: {}",
        providers_value.is_some()
    );

    if let Some(providers) = providers_value.and_then(|v| v.as_object()) {
        info!("[AI 配置] 找到 {} 个 Provider", providers.len());

        for (provider_name, provider_config) in providers {
            info!("[AI 配置] 解析 Provider: {}", provider_name);

            let base_url = provider_config
                .get("baseUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let provider_api_type = provider_config
                .get("api")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let (api_key_masked, has_api_key) =
                summarize_provider_api_key(provider_config.get("apiKey"));

            // 解析模型列表
            let models_array = provider_config.get("models").and_then(|v| v.as_array());
            info!(
                "[AI 配置] Provider {} 的 models 数组: {:?}",
                provider_name,
                models_array.map(|a| a.len())
            );

            let models: Vec<ConfiguredModel> = models_array
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            let name = m
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&id)
                                .to_string();
                            let full_id = format!("{}/{}", provider_name, id);
                            let is_primary = primary_model.as_ref() == Some(&full_id);

                            info!(
                                "[AI 配置] 解析模型: {} (is_primary: {})",
                                full_id, is_primary
                            );

                            Some(ConfiguredModel {
                                full_id,
                                id,
                                name,
                                api_type: m
                                    .get("api")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                                input: m
                                    .get("input")
                                    .and_then(|v| v.as_array())
                                    .map(|items| {
                                        items
                                            .iter()
                                            .filter_map(|item| item.as_str().map(|s| s.to_string()))
                                            .collect()
                                    })
                                    .unwrap_or_default(),
                                context_window: m
                                    .get("contextWindow")
                                    .and_then(|v| v.as_u64())
                                    .map(|n| n as u32),
                                max_tokens: m
                                    .get("maxTokens")
                                    .and_then(|v| v.as_u64())
                                    .map(|n| n as u32),
                                reasoning: m.get("reasoning").and_then(|v| v.as_bool()),
                                cost: parse_model_cost_config(m.get("cost")),
                                is_primary,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            info!(
                "[AI 配置] Provider {} 解析完成: {} 个模型",
                provider_name,
                models.len()
            );

            configured_providers.push(ConfiguredProvider {
                name: provider_name.clone(),
                base_url,
                api_type: provider_api_type,
                api_key_masked,
                has_api_key,
                models,
            });
        }
    } else {
        info!("[AI 配置] 未找到 providers 配置或格式不正确");
    }

    info!(
        "[AI 配置] ✓ 最终结果 - 主模型: {:?}, {} 个 Provider, {} 个可用模型",
        primary_model,
        configured_providers.len(),
        available_models.len()
    );

    Ok(AIConfigOverview {
        primary_model,
        configured_providers,
        available_models,
    })
}

/// 添加或更新 Provider
#[command]
pub async fn save_provider(
    provider_name: String,
    base_url: String,
    api_key: Option<String>,
    api_type: String,
    models: Vec<ModelConfig>,
) -> Result<String, String> {
    info!(
        "[保存 Provider] 保存 Provider: {} ({} 个模型)",
        provider_name,
        models.len()
    );

    let mut config = load_openclaw_config()?;

    // 确保路径存在
    if config.get("models").is_none() {
        config["models"] = json!({});
    }
    if config["models"].get("providers").is_none() {
        config["models"]["providers"] = json!({});
    }
    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }
    if config["agents"].get("defaults").is_none() {
        config["agents"]["defaults"] = json!({});
    }
    if config["agents"]["defaults"].get("models").is_none() {
        config["agents"]["defaults"]["models"] = json!({});
    }

    let existing_provider = config
        .get("models")
        .and_then(|models_config| models_config.get("providers"))
        .and_then(|providers| providers.get(&provider_name));
    let provider_config =
        build_merged_provider_config(existing_provider, &base_url, api_key, &api_type, &models);

    // 保存 Provider 配置
    config["models"]["providers"][&provider_name] = provider_config;

    // 仅删除已移除的模型条目，并保留现有模型下的 params/alias 等扩展配置。
    sync_provider_default_model_entries(&mut config, &provider_name, &models);
    clear_primary_model_if_removed(&mut config, &provider_name, &models);

    // 更新元数据
    touch_config_meta(&mut config);

    save_openclaw_config(&config)?;
    info!("[保存 Provider] ✓ Provider {} 保存成功", provider_name);

    Ok(format!("Provider {} 已保存", provider_name))
}

/// 删除 Provider
#[command]
pub async fn delete_provider(provider_name: String) -> Result<String, String> {
    info!("[删除 Provider] 删除 Provider: {}", provider_name);

    let mut config = load_openclaw_config()?;

    // 删除 Provider 配置
    if let Some(providers) = config
        .pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
    {
        providers.remove(&provider_name);
    }

    // 删除相关模型
    if let Some(models) = config
        .pointer_mut("/agents/defaults/models")
        .and_then(|v| v.as_object_mut())
    {
        let keys_to_remove: Vec<String> = models
            .keys()
            .filter(|k| k.starts_with(&format!("{}/", provider_name)))
            .cloned()
            .collect();

        for key in keys_to_remove {
            models.remove(&key);
        }
    }

    // 如果主模型属于该 Provider，清除主模型
    if let Some(primary) = config
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
    {
        if primary.starts_with(&format!("{}/", provider_name)) {
            // 删除 primary key 而不是设置为 null，避免配置文件中残留 "primary": null
            if let Some(model_obj) = config
                .pointer_mut("/agents/defaults/model")
                .and_then(|v| v.as_object_mut())
            {
                model_obj.remove("primary");
            }
        }
    }

    touch_config_meta(&mut config);

    save_openclaw_config(&config)?;
    info!("[删除 Provider] ✓ Provider {} 已删除", provider_name);

    Ok(format!("Provider {} 已删除", provider_name))
}

/// 设置主模型
#[command]
pub async fn set_primary_model(model_id: String) -> Result<String, String> {
    info!("[设置主模型] 设置主模型: {}", model_id);

    let mut config = load_openclaw_config()?;

    // 确保路径存在
    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }
    if config["agents"].get("defaults").is_none() {
        config["agents"]["defaults"] = json!({});
    }
    if config["agents"]["defaults"].get("model").is_none() {
        config["agents"]["defaults"]["model"] = json!({});
    }

    // 设置主模型
    config["agents"]["defaults"]["model"]["primary"] = json!(model_id);

    save_openclaw_config(&config)?;
    info!("[设置主模型] ✓ 主模型已设置为: {}", model_id);

    Ok(format!("主模型已设置为 {}", model_id))
}

/// 切换模型（通过 openclaw CLI 命令）
/// 使用 `openclaw models set` 命令，会同时处理白名单和设置主模型
#[command]
pub async fn switch_model(model_id: String) -> Result<String, String> {
    info!("[切换模型] 通过 CLI 切换模型: {}", model_id);
    match shell::run_openclaw(&["models", "set", &model_id]) {
        Ok(output) => {
            info!("[切换模型] ✓ 模型已切换: {}", output.trim());
            Ok(output.trim().to_string())
        }
        Err(e) => {
            warn!("[切换模型] ✗ 切换失败: {}", e);
            Err(format!("切换模型失败: {}", e))
        }
    }
}

/// 添加模型到可用列表
#[command]
pub async fn add_available_model(model_id: String) -> Result<String, String> {
    info!("[添加模型] 添加模型到可用列表: {}", model_id);

    let mut config = load_openclaw_config()?;

    // 确保路径存在
    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }
    if config["agents"].get("defaults").is_none() {
        config["agents"]["defaults"] = json!({});
    }
    if config["agents"]["defaults"].get("models").is_none() {
        config["agents"]["defaults"]["models"] = json!({});
    }

    // 添加模型
    config["agents"]["defaults"]["models"][&model_id] = json!({});

    save_openclaw_config(&config)?;
    info!("[添加模型] ✓ 模型 {} 已添加", model_id);

    Ok(format!("模型 {} 已添加", model_id))
}

// ============ 旧版兼容 ============

/// 获取所有支持的 AI Provider（旧版兼容）
#[command]
pub async fn get_ai_providers() -> Result<Vec<crate::models::AIProviderOption>, String> {
    info!("[AI Provider] 获取支持的 AI Provider 列表（旧版）...");

    let official = get_official_providers().await?;
    let providers: Vec<crate::models::AIProviderOption> = official
        .into_iter()
        .map(|p| crate::models::AIProviderOption {
            id: p.id,
            name: p.name,
            icon: p.icon,
            default_base_url: p.default_base_url,
            requires_api_key: p.requires_api_key,
            models: p
                .suggested_models
                .into_iter()
                .map(|m| crate::models::AIModelOption {
                    id: m.id,
                    name: m.name,
                    description: m.description,
                    recommended: m.recommended,
                })
                .collect(),
        })
        .collect();

    Ok(providers)
}

// ============ 渠道配置 ============

/// 获取渠道配置 - 从 openclaw.json 和 env 文件读取
#[command]
pub async fn get_channels_config() -> Result<Vec<ChannelConfig>, String> {
    info!("[渠道配置] 获取渠道配置列表...");

    let config = load_openclaw_config()?;
    let channels_obj = config.get("channels").cloned().unwrap_or(json!({}));
    let env_path = platform::get_env_file_path();
    debug!("[渠道配置] 环境文件路径: {}", env_path);

    let mut channels = Vec::new();

    let channel_types = desktop_supported_channel_types();

    let array_fields = ["allowFrom", "groupAllowFrom"];

    for (channel_id, channel_type, test_fields) in channel_types {
        let channel_config = channels_obj.get(channel_id);

        // 将渠道配置转换为 HashMap
        let mut config_map: HashMap<String, Value> = if let Some(cfg) = channel_config {
            if let Some(obj) = cfg.as_object() {
                let mut map = HashMap::new();
                for (k, v) in obj {
                    if k == "enabled" {
                        continue;
                    }
                    if array_fields.contains(&k.as_str()) {
                        if let Some(arr) = v.as_array() {
                            let strings: Vec<String> = arr
                                .iter()
                                .filter_map(|item| {
                                    if let Some(s) = item.as_str() {
                                        Some(s.to_string())
                                    } else {
                                        item.as_i64().map(|n| n.to_string())
                                    }
                                })
                                .collect();
                            map.insert(k.clone(), json!(strings.join(", ")));
                            continue;
                        }
                    }
                    map.insert(k.clone(), v.clone());
                }
                // Discord botToken -> token migration on read
                if channel_id == "discord" {
                    if let Some(bt) = map.remove("botToken") {
                        if !map.contains_key("token") {
                            map.insert("token".to_string(), bt);
                        }
                    }
                }
                map
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        // 从 env 文件读取测试字段
        for field in test_fields {
            let env_key = format!(
                "OPENCLAW_{}_{}",
                channel_id.to_uppercase(),
                field.to_uppercase()
            );
            if let Some(value) = file::read_env_value(&env_path, &env_key) {
                config_map.insert(field.to_string(), json!(value));
            }
        }

        // 仅真实渠道配置项算“已配置”，测试字段和裸 enabled 不算
        let has_config = channel_has_persisted_config(channel_config);

        channels.push(ChannelConfig {
            id: channel_id.to_string(),
            channel_type: channel_type.to_string(),
            enabled: has_config,
            config: config_map,
        });
    }

    info!("[渠道配置] ✓ 返回 {} 个渠道配置", channels.len());
    for ch in &channels {
        debug!("[渠道配置] - {}: enabled={}", ch.id, ch.enabled);
    }
    Ok(channels)
}

/// 保存渠道配置 - 保存到 openclaw.json
#[command]
pub async fn save_channel_config(channel: ChannelConfig) -> Result<String, String> {
    info!(
        "[保存渠道配置] 保存渠道配置: {} ({})",
        channel.id, channel.channel_type
    );

    let mut config = load_openclaw_config()?;
    let env_path = platform::get_env_file_path();
    debug!("[保存渠道配置] 环境文件路径: {}", env_path);

    // 确保 channels 对象存在
    if config.get("channels").is_none() {
        config["channels"] = json!({});
    }

    // 确保 plugins 对象存在
    if config.get("plugins").is_none() {
        config["plugins"] = json!({
            "entries": {}
        });
    }
    if config["plugins"].get("entries").is_none() {
        config["plugins"]["entries"] = json!({});
    }

    // 这些字段只用于测试，不保存到 openclaw.json，而是保存到 env 文件
    let test_only_fields = ["userId", "testChatId", "testChannelId"];
    let array_fields = ["allowFrom", "groupAllowFrom"];

    // 构建渠道配置
    let mut channel_obj = json!({});

    // 添加渠道特定配置
    for (key, value) in &channel.config {
        if test_only_fields.contains(&key.as_str()) {
            // 保存到 env 文件
            let env_key = format!(
                "OPENCLAW_{}_{}",
                channel.id.to_uppercase(),
                key.to_uppercase()
            );
            if let Some(val_str) = value.as_str() {
                let trimmed = val_str.trim();
                if trimmed.is_empty() {
                    let _ = file::remove_env_value(&env_path, &env_key);
                } else {
                    let _ = file::set_env_value(&env_path, &env_key, trimmed);
                }
            }
        } else if array_fields.contains(&key.as_str()) {
            // 处理字符串逗号分隔数组类型转换
            if let Some(s) = value.as_str() {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    channel_obj[key] = json!([]);
                } else {
                    let arr: Vec<String> = trimmed
                        .split(',')
                        .map(|part| part.trim().to_string())
                        .filter(|part| !part.is_empty())
                        .collect();
                    channel_obj[key] = json!(arr);
                }
            } else if value.is_array() {
                channel_obj[key] = value.clone();
            } else {
                channel_obj[key] = json!([]);
            }
        } else {
            // 保存到 openclaw.json
            channel_obj[key] = value.clone();
        }
    }

    if should_persist_desktop_channel_config(&channel.id, &channel_obj) {
        channel_obj["enabled"] = json!(true);
        config["channels"][&channel.id] = channel_obj;
        config["plugins"]["entries"][&channel.id] = json!({
            "enabled": true
        });
    } else {
        if let Some(channels) = config.get_mut("channels").and_then(|v| v.as_object_mut()) {
            channels.remove(&channel.id);
        }
        if let Some(entries) = config
            .pointer_mut("/plugins/entries")
            .and_then(|v| v.as_object_mut())
        {
            entries.remove(&channel.id);
        }
    }

    // 保存配置
    info!("[保存渠道配置] 写入配置文件...");
    match save_openclaw_config(&config) {
        Ok(_) => {
            info!("[保存渠道配置] ✓ {} 配置保存成功", channel.channel_type);
            Ok(format!("{} 配置已保存", channel.channel_type))
        }
        Err(e) => {
            error!("[保存渠道配置] ✗ 保存失败: {}", e);
            Err(e)
        }
    }
}

/// 清空渠道配置 - 从 openclaw.json 中删除指定渠道的配置
#[command]
pub async fn clear_channel_config(channel_id: String) -> Result<String, String> {
    info!("[清空渠道配置] 清空渠道配置: {}", channel_id);

    let mut config = load_openclaw_config()?;
    let env_path = platform::get_env_file_path();

    // 从 channels 对象中删除该渠道
    if let Some(channels) = config.get_mut("channels").and_then(|v| v.as_object_mut()) {
        channels.remove(&channel_id);
        info!("[清空渠道配置] 已从 channels 中删除: {}", channel_id);
    }

    // 从 plugins.entries 中删除
    if let Some(entries) = config
        .pointer_mut("/plugins/entries")
        .and_then(|v| v.as_object_mut())
    {
        entries.remove(&channel_id);
        info!("[清空渠道配置] 已从 plugins.entries 中删除: {}", channel_id);
    }

    // 清除相关的环境变量
    let env_prefixes = [
        format!("OPENCLAW_{}_USERID", channel_id.to_uppercase()),
        format!("OPENCLAW_{}_TESTCHATID", channel_id.to_uppercase()),
        format!("OPENCLAW_{}_TESTCHANNELID", channel_id.to_uppercase()),
    ];
    for env_key in env_prefixes {
        let _ = file::remove_env_value(&env_path, &env_key);
    }

    // 保存配置
    match save_openclaw_config(&config) {
        Ok(_) => {
            info!("[清空渠道配置] ✓ {} 配置已清空", channel_id);
            Ok(format!("{} 配置已清空", channel_id))
        }
        Err(e) => {
            error!("[清空渠道配置] ✗ 清空失败: {}", e);
            Err(e)
        }
    }
}

// ============ 飞书插件管理 ============

/// 确保所有内置渠道插件在配置中已启用，并禁用 OpenClaw 内置更新检查
/// 桌面端内置了所有渠道插件，启动时调用此函数预写 plugins.entries
/// 同时禁用 OpenClaw 的 update.checkOnStart 和 update.auto.enabled，
/// 因为桌面版使用 Tauri 自带的更新机制，不需要 OpenClaw 的 npm 更新检查
pub fn ensure_channel_plugins_enabled() -> Result<(), String> {
    let mut config = load_openclaw_config()?;
    let repaired_channels = repair_invalid_desktop_channel_configs(&mut config);

    // 确保 plugins.entries 存在
    if config.get("plugins").is_none() {
        config["plugins"] = json!({ "entries": {} });
    }
    if config["plugins"].get("entries").is_none() {
        config["plugins"]["entries"] = json!({});
    }

    let channel_ids = builtin_channel_plugin_ids();

    let entries = config["plugins"]["entries"]
        .as_object_mut()
        .ok_or("plugins.entries 不是对象")?;

    let mut changed = false;
    for id in &channel_ids {
        if !entries.contains_key(*id) {
            entries.insert(id.to_string(), json!({ "enabled": true }));
            changed = true;
        }
    }

    if repaired_channels > 0 {
        changed = true;
        info!(
            "[配置初始化] 已修复 {} 个启动前无效渠道配置",
            repaired_channels
        );
    }

    // 禁用 OpenClaw 内置更新检查（桌面版使用 Tauri 更新机制）
    if config.get("update").is_none() {
        config["update"] = json!({});
    }
    let update_obj = config["update"].as_object_mut().ok_or("update 不是对象")?;

    // 禁用启动时更新检查
    if update_obj.get("checkOnStart").map(|v| v.as_bool()) != Some(Some(false)) {
        update_obj.insert("checkOnStart".to_string(), json!(false));
        changed = true;
        info!("[配置初始化] 已禁用 OpenClaw 启动时更新检查 (update.checkOnStart=false)");
    }

    // 禁用自动更新
    if update_obj.get("auto").is_none() {
        update_obj.insert("auto".to_string(), json!({}));
    }
    if let Some(auto_obj) = update_obj.get_mut("auto").and_then(|v| v.as_object_mut()) {
        if auto_obj.get("enabled").map(|v| v.as_bool()) != Some(Some(false)) {
            auto_obj.insert("enabled".to_string(), json!(false));
            changed = true;
            info!("[配置初始化] 已禁用 OpenClaw 自动更新 (update.auto.enabled=false)");
        }
    }

    if changed {
        info!("[插件初始化] 已为内置渠道插件预写 plugins.entries");
        save_openclaw_config(&config)?;
    } else {
        debug!("[插件初始化] 所有内置渠道插件已在配置中");
    }

    // 注意：不再预写 channels.* 配置，因为 gateway 在加载插件之前会验证配置，
    // 如果 channels 中包含未知的 channel id 会导致启动失败。
    // 用户需要通过 UI 手动配置渠道。

    Ok(())
}

/// 获取桌面端专用配置（~/.openclawcn/desktop.json）
#[command]
pub async fn get_desktop_config() -> Result<Value, String> {
    let config_dir = platform::get_config_dir();
    let path = format!("{}/desktop.json", config_dir);

    if !file::file_exists(&path) {
        return Ok(json!({}));
    }

    let content = file::read_file(&path).map_err(|e| format!("读取桌面配置失败: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("解析桌面配置失败: {}", e))
}

/// 保存桌面端专用配置（合并写入 ~/.openclawcn/desktop.json）
#[command]
pub async fn save_desktop_config(config: Value) -> Result<(), String> {
    let config_dir = platform::get_config_dir();
    let path = format!("{}/desktop.json", config_dir);

    // 读取现有配置
    let mut existing: Value = if file::file_exists(&path) {
        let content = file::read_file(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or(json!({}))
    } else {
        json!({})
    };

    // 深度合并新值（递归合并嵌套对象，防止覆盖丢失）
    fn deep_merge(base: &mut Value, patch: &Value) {
        match (base, patch) {
            (Value::Object(base_map), Value::Object(patch_map)) => {
                for (k, v) in patch_map {
                    let entry = base_map.entry(k.clone()).or_insert(json!(null));
                    deep_merge(entry, v);
                }
            }
            (base, patch) => {
                *base = patch.clone();
            }
        }
    }
    deep_merge(&mut existing, &config);

    let content = serde_json::to_string_pretty(&existing)
        .map_err(|e| format!("序列化桌面配置失败: {}", e))?;
    file::write_file(&path, &content).map_err(|e| format!("写入桌面配置失败: {}", e))?;

    info!("[Config] 桌面配置已保存: {}", path);
    Ok(())
}

/// 打开配置目录
#[command]
pub async fn open_config_dir() -> Result<(), String> {
    let config_dir = platform::get_config_dir();
    info!("[Config] 打开配置目录: {}", config_dir);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&config_dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&config_dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&config_dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    Ok(())
}

/// 打开系统目录选择对话框，返回选中的目录路径
#[command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择允许访问的目录")
        .pick_folder();

    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

/// 检查开机自启是否启用
#[command]
pub async fn autostart_is_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    manager
        .is_enabled()
        .map_err(|e| format!("检查自启状态失败: {}", e))
}

/// 启用开机自启
#[command]
pub async fn autostart_enable(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    manager
        .enable()
        .map_err(|e| format!("启用自启失败: {}", e))?;
    info!("[Config] 已启用开机自启");
    Ok(())
}

/// 禁用开机自启
#[command]
pub async fn autostart_disable(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    manager
        .disable()
        .map_err(|e| format!("禁用自启失败: {}", e))?;
    info!("[Config] 已禁用开机自启");
    Ok(())
}

// ============ 配对码审批 ============

use crate::models::status::{PairingApproveResult, PairingRequest};

fn parse_pairing_requests_output(
    channel: &str,
    output: &str,
) -> Result<Vec<PairingRequest>, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        let message = format!("pairing list returned empty JSON output for {}", channel);
        warn!("[配对请求] {}", message);
        return Err(message);
    }
    if trimmed == "[]" {
        info!("[配对请求] {} 无待审批请求", channel);
        return Ok(vec![]);
    }
    // CLI outputs { "channel": "...", "requests": [...] }
    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(requests_val) = wrapper.get("requests") {
            match serde_json::from_value::<Vec<PairingRequest>>(requests_val.clone()) {
                Ok(requests) => {
                    info!(
                        "[配对请求] ✓ {} 有 {} 个待审批请求",
                        channel,
                        requests.len()
                    );
                    return Ok(requests);
                }
                Err(e) => {
                    warn!("[配对请求] requests 数组解析失败: {}", e);
                }
            }
        }
        // Fallback: try parsing as direct array
        if let Ok(requests) = serde_json::from_value::<Vec<PairingRequest>>(wrapper) {
            info!(
                "[配对请求] ✓ {} 有 {} 个待审批请求（直接数组）",
                channel,
                requests.len()
            );
            return Ok(requests);
        }
    }
    let snippet = &trimmed[..trimmed.len().min(200)];
    let message = format!(
        "failed to parse pairing list JSON for {}: {}",
        channel, snippet
    );
    warn!("[配对请求] {}", message);
    Err(message)
}

fn map_list_pairing_requests_result(
    channel: &str,
    result: Result<String, String>,
) -> Result<Vec<PairingRequest>, String> {
    match result {
        Ok(output) => parse_pairing_requests_output(channel, &output),
        Err(e) => {
            warn!("[配对请求] 获取失败: {}", e);
            Err(e)
        }
    }
}

/// 获取指定渠道的待审批配对请求列表
#[command]
pub async fn list_pairing_requests(channel: String) -> Result<Vec<PairingRequest>, String> {
    info!("[配对请求] 获取 {} 的配对请求列表...", channel);
    map_list_pairing_requests_result(
        &channel,
        shell::run_openclaw(&["pairing", "list", "--channel", &channel, "--json"]),
    )
}

/// 审批配对码
#[command]
pub async fn approve_pairing_code(
    channel: String,
    code: String,
) -> Result<PairingApproveResult, String> {
    info!("[配对审批] 审批 {} 配对码: {}", channel, code);

    // 简单剥离 ANSI 转义序列（CLI 输出带颜色码）
    fn strip_ansi(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let mut in_esc = false;
        for c in s.chars() {
            if c == '\x1b' {
                in_esc = true;
                continue;
            }
            if in_esc {
                if c.is_ascii_alphabetic() {
                    in_esc = false;
                }
                continue;
            }
            out.push(c);
        }
        out
    }

    match shell::run_openclaw(&["pairing", "approve", &channel, &code, "--notify"]) {
        Ok(output) => {
            let clean = strip_ansi(output.trim());
            info!("[配对审批] ✓ 审批成功: {}", clean);
            Ok(PairingApproveResult {
                success: true,
                message: clean,
            })
        }
        Err(e) => {
            let clean = strip_ansi(&e);
            error!("[配对审批] ✗ 审批失败: {}", clean);
            Ok(PairingApproveResult {
                success: false,
                message: format!("审批失败: {}", clean),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_merged_provider_config, channel_has_persisted_config, clear_primary_model_if_removed,
        has_meaningful_channel_value, map_list_pairing_requests_result, parse_model_cost_config,
        parse_pairing_requests_output, repair_invalid_desktop_channel_configs,
        summarize_provider_api_key, sync_provider_default_model_entries, touch_config_meta,
    };
    use crate::models::{ModelConfig, ModelCostConfig};
    use serde_json::json;

    #[test]
    fn channel_value_ignores_enabled_and_empty_fields() {
        assert!(!has_meaningful_channel_value(&json!({ "enabled": true })));
        assert!(!has_meaningful_channel_value(
            &json!({ "enabled": true, "token": "   " })
        ));
        assert!(!has_meaningful_channel_value(
            &json!({ "testChannelId": "123" })
        ));
        assert!(has_meaningful_channel_value(
            &json!({ "enabled": true, "token": "abc" })
        ));
        assert!(has_meaningful_channel_value(&json!({ "allowFrom": ["x"] })));
    }

    #[test]
    fn channel_has_persisted_config_only_counts_real_channel_config() {
        assert!(!channel_has_persisted_config(None));
        assert!(!channel_has_persisted_config(Some(
            &json!({ "enabled": true })
        )));
        assert!(!channel_has_persisted_config(Some(
            &json!({ "userId": "10001" })
        )));
        assert!(channel_has_persisted_config(Some(
            &json!({ "botToken": "123:abc" })
        )));
    }

    #[test]
    fn parse_pairing_requests_output_reads_wrapped_json_requests() {
        let parsed = parse_pairing_requests_output(
            "discord",
            r#"{"channel":"discord","requests":[{"code":"ABC123","id":"user-1","createdAt":"2026-04-04T00:00:00Z"}]}"#,
        )
        .expect("wrapped requests should parse");

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].code, "ABC123");
        assert_eq!(parsed[0].id.as_deref(), Some("user-1"));
        assert_eq!(
            parsed[0].created_at.as_deref(),
            Some("2026-04-04T00:00:00Z")
        );
    }

    #[test]
    fn parse_pairing_requests_output_rejects_invalid_json() {
        let err = parse_pairing_requests_output("discord", "{not-json}")
            .expect_err("invalid json should surface as an error");
        assert!(err.contains("failed to parse pairing list JSON for discord"));
    }

    #[test]
    fn parse_pairing_requests_output_rejects_empty_output() {
        let err = parse_pairing_requests_output("discord", "   ")
            .expect_err("empty output should surface as an error");
        assert!(err.contains("pairing list returned empty JSON output for discord"));
    }

    #[test]
    fn parse_pairing_requests_output_rejects_empty_object_output() {
        let err = parse_pairing_requests_output("discord", "{}")
            .expect_err("empty object should not masquerade as an empty request list");
        assert!(err.contains("failed to parse pairing list JSON for discord"));
    }

    #[test]
    fn list_pairing_requests_propagates_shell_failures() {
        let err = map_list_pairing_requests_result("discord", Err("cli failed".to_string()))
            .expect_err("shell errors should reach the frontend");
        assert_eq!(err, "cli failed");
    }

    #[test]
    fn repair_invalid_desktop_channel_configs_removes_empty_placeholder_channels() {
        let mut config = json!({
            "channels": {
                "wecom": {
                    "enabled": true,
                    "token": "   ",
                    "encodingAesKey": ""
                },
                "dingtalk": {
                    "enabled": true,
                    "clientId": "",
                    "clientSecret": "   "
                },
                "telegram": {
                    "enabled": true,
                    "botToken": "123:abc"
                }
            }
        });

        let repaired = repair_invalid_desktop_channel_configs(&mut config);

        assert!(repaired > 0);
        assert!(config.pointer("/channels/wecom").is_none());
        assert!(config.pointer("/channels/dingtalk").is_none());
        assert_eq!(
            config.pointer("/channels/telegram/botToken"),
            Some(&json!("123:abc"))
        );
    }

    #[test]
    fn repair_invalid_desktop_channel_configs_drops_invalid_wecom_aes_but_keeps_token() {
        let mut config = json!({
            "channels": {
                "wecom": {
                    "enabled": true,
                    "token": "wecom-token",
                    "encodingAesKey": "short"
                }
            }
        });

        let repaired = repair_invalid_desktop_channel_configs(&mut config);

        assert!(repaired > 0);
        assert_eq!(
            config.pointer("/channels/wecom/token"),
            Some(&json!("wecom-token"))
        );
        assert!(config.pointer("/channels/wecom/encodingAesKey").is_none());
    }

    #[test]
    fn repair_invalid_desktop_channel_configs_removes_wecom_when_invalid_aes_is_all_that_remains() {
        let mut config = json!({
            "channels": {
                "wecom": {
                    "enabled": true,
                    "token": "   ",
                    "encodingAesKey": "short"
                }
            }
        });

        let repaired = repair_invalid_desktop_channel_configs(&mut config);

        assert!(repaired > 0);
        assert!(config.pointer("/channels/wecom").is_none());
    }

    #[test]
    fn repair_invalid_desktop_channel_configs_removes_malformed_scalar_channel_values() {
        let mut config = json!({
            "channels": {
                "wecom": "broken",
                "telegram": {
                    "botToken": "123:abc"
                }
            }
        });

        let repaired = repair_invalid_desktop_channel_configs(&mut config);

        assert!(repaired > 0);
        assert!(config.pointer("/channels/wecom").is_none());
        assert_eq!(
            config.pointer("/channels/telegram/botToken"),
            Some(&json!("123:abc"))
        );
    }

    #[test]
    fn repair_invalid_desktop_channel_configs_preserves_empty_whatsapp_and_imessage_objects() {
        let mut config = json!({
            "channels": {
                "whatsapp": {
                    "enabled": true,
                    "allowFrom": [],
                    "groupAllowFrom": []
                },
                "imessage": {
                    "enabled": true
                },
                "wecom": {
                    "enabled": true,
                    "token": "   ",
                    "encodingAesKey": ""
                }
            }
        });

        let repaired = repair_invalid_desktop_channel_configs(&mut config);

        assert!(repaired > 0);
        assert_eq!(
            config.pointer("/channels/whatsapp/enabled"),
            Some(&json!(true))
        );
        assert_eq!(
            config.pointer("/channels/imessage/enabled"),
            Some(&json!(true))
        );
        assert!(config.pointer("/channels/wecom").is_none());
    }

    #[test]
    fn should_persist_desktop_channel_config_preserves_empty_whatsapp_and_imessage() {
        assert!(super::should_persist_desktop_channel_config(
            "whatsapp",
            &json!({})
        ));
        assert!(super::should_persist_desktop_channel_config(
            "imessage",
            &json!({})
        ));
        assert!(!super::should_persist_desktop_channel_config(
            "wecom",
            &json!({})
        ));
        assert!(super::should_persist_desktop_channel_config(
            "telegram",
            &json!({ "botToken": "123:abc" })
        ));
    }

    #[test]
    fn repair_invalid_desktop_channel_configs_counts_trimmed_string_repairs() {
        let mut config = json!({
            "channels": {
                "telegram": {
                    "enabled": true,
                    "botToken": " 123:abc "
                }
            }
        });

        let repaired = repair_invalid_desktop_channel_configs(&mut config);

        assert_eq!(repaired, 1);
        assert_eq!(
            config.pointer("/channels/telegram/botToken"),
            Some(&json!("123:abc"))
        );
    }

    #[test]
    fn repair_invalid_desktop_channel_configs_counts_placeholder_cleanup_for_preserved_channels() {
        let mut config = json!({
            "channels": {
                "whatsapp": {
                    "enabled": true,
                    "allowFrom": ["   "]
                }
            }
        });

        let repaired = repair_invalid_desktop_channel_configs(&mut config);

        assert!(repaired > 0);
        assert_eq!(
            config.pointer("/channels/whatsapp/enabled"),
            Some(&json!(true))
        );
        assert!(config.pointer("/channels/whatsapp/allowFrom").is_none());
    }

    #[test]
    fn summarize_provider_api_key_treats_secret_ref_as_present() {
        let (masked, has_api_key) = summarize_provider_api_key(Some(&json!({
            "source": "env",
            "provider": "default",
            "id": "CUSTOM_PROVIDER_API_KEY"
        })));

        assert_eq!(masked.as_deref(), Some("已配置引用"));
        assert!(has_api_key);
    }

    #[test]
    fn build_merged_provider_config_preserves_secret_ref_and_advanced_provider_fields() {
        let existing_provider = json!({
            "baseUrl": "https://azure.example.com/openai/v1",
            "api": "openai-responses",
            "authHeader": false,
            "headers": {
                "api-key": "secretref-env:AZURE_OPENAI_API_KEY"
            },
            "apiKey": {
                "source": "env",
                "provider": "default",
                "id": "AZURE_OPENAI_API_KEY"
            },
            "models": [
                {
                    "id": "o4-mini",
                    "name": "O4 Mini",
                    "api": "openai-responses",
                    "input": ["text", "image"],
                    "reasoning": true,
                    "contextWindow": 200000,
                    "maxTokens": 8192,
                    "cost": {
                        "input": 1,
                        "output": 2,
                        "cacheRead": 3,
                        "cacheWrite": 4
                    },
                    "headers": {
                        "X-Trace": "enabled"
                    },
                    "compat": {
                        "supportsStore": false
                    }
                }
            ]
        });
        let models = vec![ModelConfig {
            id: "o4-mini".to_string(),
            name: "O4 Mini".to_string(),
            api: Some("openai-responses".to_string()),
            input: vec!["text".to_string(), "image".to_string()],
            context_window: Some(200000),
            max_tokens: Some(8192),
            reasoning: Some(true),
            cost: Some(ModelCostConfig {
                input: 1.0,
                output: 2.0,
                cache_read: 3.0,
                cache_write: 4.0,
            }),
        }];

        let merged = build_merged_provider_config(
            Some(&existing_provider),
            "https://azure.example.com/openai/v1",
            None,
            "openai-responses",
            &models,
        );

        assert_eq!(
            merged.pointer("/apiKey"),
            Some(&json!({
                "source": "env",
                "provider": "default",
                "id": "AZURE_OPENAI_API_KEY"
            }))
        );
        assert_eq!(merged.pointer("/api"), Some(&json!("openai-responses")));
        assert_eq!(merged.pointer("/authHeader"), Some(&json!(false)));
        assert_eq!(
            merged.pointer("/headers/api-key"),
            Some(&json!("secretref-env:AZURE_OPENAI_API_KEY"))
        );
        assert_eq!(
            merged.pointer("/models/0/headers/X-Trace"),
            Some(&json!("enabled"))
        );
        assert_eq!(
            merged.pointer("/models/0/compat/supportsStore"),
            Some(&json!(false))
        );
    }

    #[test]
    fn build_merged_provider_config_keeps_existing_model_fields_when_payload_omits_them() {
        let existing_provider = json!({
            "baseUrl": "https://llm.example.com/v1",
            "api": "openai-completions",
            "models": [
                {
                    "id": "foo-large",
                    "name": "Foo Large",
                    "api": "openai-completions",
                    "input": ["text", "image"],
                    "reasoning": true,
                    "contextWindow": 131072,
                    "maxTokens": 16384,
                    "cost": {
                        "input": 5,
                        "output": 6,
                        "cacheRead": 7,
                        "cacheWrite": 8
                    },
                    "compat": {
                        "supportsStore": false
                    }
                }
            ]
        });
        let models = vec![ModelConfig {
            id: "foo-large".to_string(),
            name: "Foo Large".to_string(),
            api: Some("openai-completions".to_string()),
            input: Vec::new(),
            context_window: Some(131072),
            max_tokens: Some(16384),
            reasoning: None,
            cost: None,
        }];

        let merged = build_merged_provider_config(
            Some(&existing_provider),
            "https://llm.example.com/v1",
            None,
            "openai-completions",
            &models,
        );

        assert_eq!(
            merged.pointer("/models/0/input"),
            Some(&json!(["text", "image"]))
        );
        assert_eq!(merged.pointer("/models/0/reasoning"), Some(&json!(true)));
        assert_eq!(merged.pointer("/models/0/cost/cacheWrite"), Some(&json!(8)));
        assert_eq!(
            merged.pointer("/models/0/compat/supportsStore"),
            Some(&json!(false))
        );
    }

    #[test]
    fn build_merged_provider_config_keeps_new_model_optional_fields_unset_when_payload_omits_them()
    {
        let existing_provider = json!({
            "baseUrl": "https://llm.example.com/v1",
            "api": "openai-completions",
            "models": []
        });
        let models = vec![ModelConfig {
            id: "new-model".to_string(),
            name: "New Model".to_string(),
            api: None,
            input: Vec::new(),
            context_window: Some(200000),
            max_tokens: Some(8192),
            reasoning: None,
            cost: None,
        }];

        let merged = build_merged_provider_config(
            Some(&existing_provider),
            "https://llm.example.com/v1",
            None,
            "openai-completions",
            &models,
        );

        assert_eq!(merged.pointer("/api"), Some(&json!("openai-completions")));
        assert!(merged.pointer("/models/0/api").is_none());
        assert!(merged.pointer("/models/0/input").is_none());
        assert!(merged.pointer("/models/0/reasoning").is_none());
        assert!(merged.pointer("/models/0/cost").is_none());
        assert_eq!(
            merged.pointer("/models/0/contextWindow"),
            Some(&json!(200000))
        );
        assert_eq!(merged.pointer("/models/0/maxTokens"), Some(&json!(8192)));
    }

    #[test]
    fn sync_provider_default_model_entries_preserves_existing_model_params_and_aliases() {
        let mut config = json!({
            "agents": {
                "defaults": {
                    "models": {
                        "custom/foo": {
                            "params": { "thinking": "high" }
                        },
                        "custom/bar": {
                            "alias": "fast"
                        },
                        "custom/removed": {
                            "params": { "thinking": "low" }
                        },
                        "other/model": {
                            "alias": "keep"
                        }
                    }
                }
            }
        });
        let models = vec![
            ModelConfig {
                id: "foo".to_string(),
                name: "Foo".to_string(),
                api: None,
                input: Vec::new(),
                context_window: None,
                max_tokens: None,
                reasoning: None,
                cost: None,
            },
            ModelConfig {
                id: "bar".to_string(),
                name: "Bar".to_string(),
                api: None,
                input: Vec::new(),
                context_window: None,
                max_tokens: None,
                reasoning: None,
                cost: None,
            },
            ModelConfig {
                id: "new".to_string(),
                name: "New".to_string(),
                api: None,
                input: Vec::new(),
                context_window: None,
                max_tokens: None,
                reasoning: None,
                cost: None,
            },
        ];

        sync_provider_default_model_entries(&mut config, "custom", &models);

        let defaults_models = config["agents"]["defaults"]["models"]
            .as_object()
            .expect("defaults models should exist");
        assert_eq!(
            defaults_models
                .get("custom/foo")
                .and_then(|value| value.get("params"))
                .and_then(|value| value.get("thinking")),
            Some(&json!("high"))
        );
        assert_eq!(
            defaults_models
                .get("custom/bar")
                .and_then(|value| value.get("alias")),
            Some(&json!("fast"))
        );
        assert_eq!(defaults_models.get("custom/new"), Some(&json!({})));
        assert!(!defaults_models.contains_key("custom/removed"));
        assert_eq!(
            defaults_models
                .get("other/model")
                .and_then(|value| value.get("alias")),
            Some(&json!("keep"))
        );
    }

    #[test]
    fn clear_primary_model_if_removed_clears_stale_primary_entry() {
        let mut config = json!({
            "agents": {
                "defaults": {
                    "model": {
                        "primary": "custom/removed"
                    }
                }
            }
        });
        let models = vec![ModelConfig {
            id: "kept".to_string(),
            name: "Kept".to_string(),
            api: None,
            input: Vec::new(),
            context_window: None,
            max_tokens: None,
            reasoning: None,
            cost: None,
        }];

        clear_primary_model_if_removed(&mut config, "custom", &models);

        assert!(config.pointer("/agents/defaults/model/primary").is_none());
    }

    #[test]
    fn clear_primary_model_if_removed_keeps_primary_when_still_present() {
        let mut config = json!({
            "agents": {
                "defaults": {
                    "model": {
                        "primary": "custom/kept"
                    }
                }
            }
        });
        let models = vec![ModelConfig {
            id: "kept".to_string(),
            name: "Kept".to_string(),
            api: None,
            input: Vec::new(),
            context_window: None,
            max_tokens: None,
            reasoning: None,
            cost: None,
        }];

        clear_primary_model_if_removed(&mut config, "custom", &models);

        assert_eq!(
            config.pointer("/agents/defaults/model/primary"),
            Some(&json!("custom/kept"))
        );
    }

    #[test]
    fn parse_model_cost_config_ignores_malformed_or_empty_values() {
        assert!(parse_model_cost_config(Some(&json!("broken"))).is_none());
        assert!(parse_model_cost_config(Some(&json!({}))).is_none());
        assert!(parse_model_cost_config(Some(&json!({
            "input": "0.5",
            "output": "1.0"
        })))
        .is_none());
    }

    #[test]
    fn parse_model_cost_config_accepts_partial_numeric_costs() {
        let cost = parse_model_cost_config(Some(&json!({
            "input": 0.5,
            "cacheWrite": 1.25
        })))
        .expect("partial numeric cost should parse");

        assert_eq!(cost.input, 0.5);
        assert_eq!(cost.output, 0.0);
        assert_eq!(cost.cache_read, 0.0);
        assert_eq!(cost.cache_write, 1.25);
    }

    #[test]
    fn touch_config_meta_sets_last_touched_at() {
        let mut config = json!({});

        touch_config_meta(&mut config);

        let timestamp = config
            .pointer("/meta/lastTouchedAt")
            .and_then(|value| value.as_str())
            .expect("timestamp should be set");
        assert!(chrono::DateTime::parse_from_rfc3339(timestamp).is_ok());
    }
}
