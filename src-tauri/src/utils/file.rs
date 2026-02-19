use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::Path;

/// 读取文件内容
pub fn read_file(path: &str) -> io::Result<String> {
    fs::read_to_string(path)
}

/// 写入文件内容
pub fn write_file(path: &str, content: &str) -> io::Result<()> {
    // 确保父目录存在
    if let Some(parent) = Path::new(path).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)
}

/// 追加文件内容
pub fn append_file(path: &str, content: &str) -> io::Result<()> {
    use std::fs::OpenOptions;
    use std::io::Write;
    
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    
    writeln!(file, "{}", content)
}

/// 检查文件是否存在
pub fn file_exists(path: &str) -> bool {
    Path::new(path).exists()
}

/// 读取文件最后 N 行
pub fn read_last_lines(path: &str, n: usize) -> io::Result<Vec<String>> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
    
    let start = if lines.len() > n { lines.len() - n } else { 0 };
    Ok(lines[start..].to_vec())
}

/// 从环境变量文件读取值
/// 支持 `export KEY=VALUE` 和 `KEY=VALUE` 两种格式
pub fn read_env_value(env_file: &str, key: &str) -> Option<String> {
    let content = read_file(env_file).ok()?;
    
    for line in content.lines() {
        let line = line.trim();
        // 跳过注释和空行
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // 去除 export 前缀（如果有）
        let line = line.strip_prefix("export ").unwrap_or(line);
        // 匹配 KEY=VALUE
        if let Some(value_part) = line.strip_prefix(&format!("{}=", key)) {
            let value = value_part
                .trim_matches('"')
                .trim_matches('\'');
            return Some(value.to_string());
        }
    }
    
    None
}

/// 设置环境变量文件中的值
pub fn set_env_value(env_file: &str, key: &str, value: &str) -> io::Result<()> {
    let content = read_file(env_file).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // defense-in-depth: 转义反斜杠和双引号
    let escaped_value = value.replace('\\', "\\\\").replace('"', "\\\"");
    let new_line = format!("export {}=\"{}\"", key, escaped_value);
    let mut found = false;
    
    let export_prefix = format!("export {}=", key);
    let bare_prefix = format!("{}=", key);
    
    for line in &mut lines {
        let trimmed = line.trim();
        // 匹配 export KEY= 或 bare KEY= 格式
        if trimmed.starts_with(&export_prefix) || 
           (trimmed.starts_with(&bare_prefix) && !trimmed.starts_with("export ")) {
            *line = new_line.clone();
            found = true;
            break;
        }
    }
    
    if !found {
        lines.push(new_line);
    }
    
    write_file(env_file, &lines.join("\n"))
}


/// 从环境变量文件中删除指定的值
/// 支持删除 `export KEY=VALUE` 和 `KEY=VALUE` 两种格式
pub fn remove_env_value(env_file: &str, key: &str) -> io::Result<()> {
    let content = read_file(env_file).unwrap_or_default();
    let export_prefix = format!("export {}=", key);
    let bare_prefix = format!("{}=", key);
    
    let lines: Vec<String> = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            // 保留不匹配的行（删除匹配 export KEY= 或 bare KEY= 的行）
            !trimmed.starts_with(&export_prefix) && 
            !(trimmed.starts_with(&bare_prefix) && !trimmed.starts_with("export "))
        })
        .map(|s| s.to_string())
        .collect();
    
    write_file(env_file, &lines.join("\n"))
}
