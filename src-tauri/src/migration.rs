use crate::utils::{file, platform};
use log::{error, info, warn};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::path::PathBuf;

/// 当前配置版本（与应用版本保持一致）
const CURRENT_CONFIG_VERSION: &str = "0.2.9";

/// 配置迁移结果
#[derive(Debug)]
pub enum MigrationResult {
    /// 无需迁移（配置版本已是最新）
    NoMigrationNeeded,
    /// 迁移成功
    Success {
        from_version: String,
        to_version: String,
        backup_path: String,
    },
    /// 迁移失败
    Failed {
        error: String,
    },
}

/// 检查并执行配置迁移
pub fn check_and_migrate() -> MigrationResult {
    info!("[配置迁移] 开始检查配置版本...");

    let config_path = platform::get_config_file_path();

    // 如果配置文件不存在，无需迁移
    if !file::file_exists(&config_path) {
        info!("[配置迁移] 配置文件不存在，无需迁移");
        return MigrationResult::NoMigrationNeeded;
    }

    // 读取配置文件
    let config = match load_config() {
        Ok(cfg) => cfg,
        Err(e) => {
            error!("[配置迁移] 读取配置文件失败: {}", e);
            return MigrationResult::Failed {
                error: format!("读取配置文件失败: {}", e),
            };
        }
    };

    // 获取当前配置版本
    let current_version = get_config_version(&config);

    // 检查是否需要迁移
    if current_version == CURRENT_CONFIG_VERSION {
        info!("[配置迁移] 配置版本已是最新 ({})", CURRENT_CONFIG_VERSION);
        return MigrationResult::NoMigrationNeeded;
    }

    if !should_migrate_from_version(&current_version) {
        warn!(
            "[配置迁移] 跳过不受支持的配置版本迁移: {} -> {}",
            current_version, CURRENT_CONFIG_VERSION
        );
        return MigrationResult::NoMigrationNeeded;
    }

    info!(
        "[配置迁移] 检测到配置版本不匹配: {} -> {}",
        current_version, CURRENT_CONFIG_VERSION
    );

    // 备份旧配置
    let backup_path = match backup_config(&config_path) {
        Ok(path) => {
            info!("[配置迁移] 配置已备份到: {}", path);
            path
        }
        Err(e) => {
            error!("[配置迁移] 备份配置失败: {}", e);
            return MigrationResult::Failed {
                error: format!("备份配置失败: {}", e),
            };
        }
    };

    // 执行迁移
    let migrated_config = match migrate_config(config, &current_version) {
        Ok(cfg) => cfg,
        Err(e) => {
            error!("[配置迁移] 迁移失败: {}", e);
            return MigrationResult::Failed {
                error: format!("迁移失败: {}", e),
            };
        }
    };

    // 保存迁移后的配置
    if let Err(e) = save_config(&migrated_config) {
        error!("[配置迁移] 保存迁移后的配置失败: {}", e);
        return MigrationResult::Failed {
            error: format!("保存迁移后的配置失败: {}", e),
        };
    }

    info!(
        "[配置迁移] ✓ 迁移成功: {} -> {}",
        current_version, CURRENT_CONFIG_VERSION
    );

    MigrationResult::Success {
        from_version: current_version,
        to_version: CURRENT_CONFIG_VERSION.to_string(),
        backup_path,
    }
}

/// 加载配置文件
fn load_config() -> Result<Value, String> {
    let config_path = platform::get_config_file_path();
    let content = file::read_file(&config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))
}

/// 保存配置文件
fn save_config(config: &Value) -> Result<(), String> {
    let config_path = platform::get_config_file_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    file::write_file(&config_path, &content)
        .map_err(|e| format!("写入配置文件失败: {}", e))
}

/// 获取配置版本
fn get_config_version(config: &Value) -> String {
    config
        .pointer("/meta/version")
        .and_then(|v| v.as_str())
        .unwrap_or("legacy")
        .to_string()
}

/// 备份配置文件
fn backup_config(config_path: &str) -> Result<String, String> {
    let config_dir = platform::get_config_dir();
    let backup_dir = PathBuf::from(&config_dir).join("backups");

    // 创建备份目录
    if !backup_dir.exists() {
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("创建备份目录失败: {}", e))?;
    }

    // 生成备份文件名（带时间戳）
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup_filename = format!("openclaw.json.backup-{}", timestamp);
    let backup_path = backup_dir.join(&backup_filename);

    // 复制配置文件到备份目录
    std::fs::copy(config_path, &backup_path)
        .map_err(|e| format!("复制配置文件失败: {}", e))?;

    // 清理旧备份（保留最近10个）
    cleanup_old_backups(&backup_dir, 10)?;

    Ok(backup_path.to_string_lossy().to_string())
}

/// 清理旧备份文件
fn cleanup_old_backups(backup_dir: &PathBuf, keep_count: usize) -> Result<(), String> {
    let mut backups: Vec<_> = std::fs::read_dir(backup_dir)
        .map_err(|e| format!("读取备份目录失败: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("openclaw.json.backup-")
        })
        .collect();

    // 按修改时间排序（最新的在前）
    backups.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    backups.reverse();

    // 删除超过保留数量的备份
    for entry in backups.iter().skip(keep_count) {
        if let Err(e) = std::fs::remove_file(entry.path()) {
            warn!("[配置迁移] 删除旧备份失败: {}", e);
        }
    }

    Ok(())
}

/// 执行配置迁移
fn migrate_config(mut config: Value, from_version: &str) -> Result<Value, String> {
    info!("[配置迁移] 开始迁移配置: {} -> {}", from_version, CURRENT_CONFIG_VERSION);

    // 根据源版本执行不同的迁移策略
    match from_version {
        "legacy" => {
            // 从无版本号的旧版本迁移
            migrate_from_legacy(&mut config)?;
        }
        version if version.starts_with("0.1.") => {
            // 从 0.1.x 版本迁移
            migrate_from_0_1_x(&mut config)?;
        }
        version
            if version.starts_with("0.2.")
                && compare_numeric_versions(version, CURRENT_CONFIG_VERSION)
                    == Some(Ordering::Less) =>
        {
            // 从 0.2.x 其他版本迁移
            migrate_from_0_2_x(&mut config)?;
        }
        _ => {
            warn!("[配置迁移] 未知的源版本: {}", from_version);
        }
    }

    // 更新版本号
    if !config.is_object() {
        config = json!({});
    }

    let config_obj = config.as_object_mut().unwrap();
    let meta = config_obj
        .entry("meta")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap();
    meta.insert("version".to_string(), json!(CURRENT_CONFIG_VERSION));

    Ok(config)
}

/// 从无版本号的旧版本迁移
fn migrate_from_legacy(config: &mut Value) -> Result<(), String> {
    info!("[配置迁移] 执行 legacy -> {} 迁移", CURRENT_CONFIG_VERSION);

    // 检查配置完整性
    ensure_config_structure(config);

    // 旧版本可能没有 meta 字段，添加它
    if config.get("meta").is_none() {
        if let Some(obj) = config.as_object_mut() {
            obj.insert("meta".to_string(), json!({}));
        }
    }

    Ok(())
}

/// 从 0.1.x 版本迁移
fn migrate_from_0_1_x(config: &mut Value) -> Result<(), String> {
    info!("[配置迁移] 执行 0.1.x -> {} 迁移", CURRENT_CONFIG_VERSION);

    // 检查配置完整性
    ensure_config_structure(config);

    // 0.1.x 到 0.2.x 的特定迁移逻辑
    // 例如：字段重命名、结构调整等
    // 目前暂无特定迁移需求

    Ok(())
}

/// 从 0.2.x 早期版本迁移
fn migrate_from_0_2_x(config: &mut Value) -> Result<(), String> {
    info!("[配置迁移] 执行 0.2.x -> {} 迁移", CURRENT_CONFIG_VERSION);

    // 检查配置完整性
    ensure_config_structure(config);

    // 0.2.x 内部版本的特定迁移逻辑
    // 目前暂无特定迁移需求

    Ok(())
}

/// 确保配置结构完整
fn ensure_config_structure(config: &mut Value) {
    if !config.is_object() {
        *config = json!({});
    }

    let config_obj = config.as_object_mut().unwrap();

    // 确保必要的顶级字段存在
    let required_fields = vec![
        "gateway",
        "agents",
        "models",
        "channels",
        "plugins",
        "meta",
    ];

    for field in required_fields {
        config_obj.entry(field).or_insert_with(|| json!({}));
    }

    // 确保 gateway.auth 存在
    if let Some(gateway) = config_obj.get_mut("gateway") {
        if let Some(gateway_obj) = gateway.as_object_mut() {
            gateway_obj.entry("auth").or_insert_with(|| json!({}));
        }
    }
}

fn should_migrate_from_version(version: &str) -> bool {
    match version {
        "legacy" => true,
        value if value.starts_with("0.1.") => true,
        value
            if value.starts_with("0.2.")
                && compare_numeric_versions(value, CURRENT_CONFIG_VERSION) == Some(Ordering::Less) =>
        {
            true
        }
        _ => false,
    }
}

fn compare_numeric_versions(left: &str, right: &str) -> Option<Ordering> {
    fn parse(version: &str) -> Option<Vec<u32>> {
        version
            .split('.')
            .map(|part| part.parse::<u32>().ok())
            .collect::<Option<Vec<_>>>()
    }

    let left_parts = parse(left)?;
    let right_parts = parse(right)?;
    let len = left_parts.len().max(right_parts.len());
    for index in 0..len {
        let left_part = *left_parts.get(index).unwrap_or(&0);
        let right_part = *right_parts.get(index).unwrap_or(&0);
        match left_part.cmp(&right_part) {
            Ordering::Equal => continue,
            ordering => return Some(ordering),
        }
    }
    Some(Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::{compare_numeric_versions, migrate_config, should_migrate_from_version};
    use serde_json::json;
    use std::cmp::Ordering;

    #[test]
    fn compares_numeric_versions_correctly() {
        assert_eq!(compare_numeric_versions("0.2.8", "0.2.9"), Some(Ordering::Less));
        assert_eq!(compare_numeric_versions("0.2.9", "0.2.9"), Some(Ordering::Equal));
        assert_eq!(
            compare_numeric_versions("0.2.10", "0.2.9"),
            Some(Ordering::Greater)
        );
        assert_eq!(compare_numeric_versions("0.3.0", "0.2.9"), Some(Ordering::Greater));
        assert_eq!(compare_numeric_versions("invalid", "0.2.9"), None);
    }

    #[test]
    fn only_older_supported_versions_require_migration() {
        assert!(should_migrate_from_version("legacy"));
        assert!(should_migrate_from_version("0.1.7"));
        assert!(should_migrate_from_version("0.2.8"));
        assert!(!should_migrate_from_version("0.2.9"));
        assert!(!should_migrate_from_version("0.2.10"));
        assert!(!should_migrate_from_version("0.3.0"));
        assert!(!should_migrate_from_version("future"));
    }

    #[test]
    fn migrate_config_only_rewrites_older_versions() {
        let migrated =
            migrate_config(json!({ "meta": { "version": "0.2.8" } }), "0.2.8").expect("migrate");
        assert_eq!(migrated.pointer("/meta/version").and_then(|v| v.as_str()), Some("0.2.9"));
    }
}
