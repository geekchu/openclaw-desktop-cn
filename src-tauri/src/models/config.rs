use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============ 前端交互与 API 用数据结构 ============

/// 模型配置详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// API 类型 (anthropic-messages / openai-completions)
    #[serde(default)]
    pub api: Option<String>,
    /// 支持的输入类型
    #[serde(default)]
    pub input: Vec<String>,
    /// 上下文窗口大小
    #[serde(rename = "contextWindow", default)]
    pub context_window: Option<u32>,
    /// 最大输出 Token
    #[serde(rename = "maxTokens", default)]
    pub max_tokens: Option<u32>,
    /// 是否支持推理模式
    #[serde(default)]
    pub reasoning: Option<bool>,
    /// 成本配置
    #[serde(default)]
    pub cost: Option<ModelCostConfig>,
}

/// 模型成本配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelCostConfig {
    #[serde(default)]
    pub input: f64,
    #[serde(default)]
    pub output: f64,
    #[serde(rename = "cacheRead", default)]
    pub cache_read: f64,
    #[serde(rename = "cacheWrite", default)]
    pub cache_write: f64,
}

// ============ 前端展示用数据结构 ============

/// 官方 Provider 预设（用于前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfficialProvider {
    /// Provider ID (用于配置中)
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 图标（emoji）
    pub icon: String,
    /// 官方 API 地址
    pub default_base_url: Option<String>,
    /// API 类型
    pub api_type: String,
    /// 推荐模型列表
    pub suggested_models: Vec<SuggestedModel>,
    /// 是否需要 API Key
    pub requires_api_key: bool,
    /// 文档链接
    pub docs_url: Option<String>,
}

/// 推荐模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedModel {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 描述
    pub description: Option<String>,
    /// 上下文窗口
    pub context_window: Option<u32>,
    /// 最大输出
    pub max_tokens: Option<u32>,
    /// 是否推荐
    pub recommended: bool,
}

/// 已配置的 Provider（从配置文件读取）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfiguredProvider {
    /// Provider 名称 (配置中的 key)
    pub name: String,
    /// API 地址
    pub base_url: String,
    /// Provider 级 API 类型
    pub api_type: Option<String>,
    /// API Key (脱敏显示)
    pub api_key_masked: Option<String>,
    /// 是否有 API Key
    pub has_api_key: bool,
    /// 配置的模型列表
    pub models: Vec<ConfiguredModel>,
}

/// 已配置的模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfiguredModel {
    /// 完整模型 ID (provider/model-id)
    pub full_id: String,
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// API 类型
    pub api_type: Option<String>,
    /// 支持的输入类型
    #[serde(default)]
    pub input: Vec<String>,
    /// 上下文窗口
    pub context_window: Option<u32>,
    /// 最大输出
    pub max_tokens: Option<u32>,
    /// 是否支持推理模式
    pub reasoning: Option<bool>,
    /// 成本配置
    pub cost: Option<ModelCostConfig>,
    /// 是否为主模型
    pub is_primary: bool,
}

/// AI 配置概览（返回给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfigOverview {
    /// 主模型
    pub primary_model: Option<String>,
    /// 已配置的 Provider 列表
    pub configured_providers: Vec<ConfiguredProvider>,
    /// 可用模型列表
    pub available_models: Vec<String>,
}

// ============ 旧数据结构保持兼容 ============

/// AI Provider 选项（用于前端展示）- 旧版兼容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIProviderOption {
    /// Provider ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 图标（emoji）
    pub icon: String,
    /// 官方 API 地址
    pub default_base_url: Option<String>,
    /// 推荐模型列表
    pub models: Vec<AIModelOption>,
    /// 是否需要 API Key
    pub requires_api_key: bool,
}

/// AI 模型选项 - 旧版兼容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIModelOption {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 描述
    pub description: Option<String>,
    /// 是否推荐
    pub recommended: bool,
}

/// 渠道配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelConfig {
    /// 渠道 ID
    pub id: String,
    /// 渠道类型
    pub channel_type: String,
    /// 是否启用
    pub enabled: bool,
    /// 配置详情
    pub config: HashMap<String, serde_json::Value>,
}
