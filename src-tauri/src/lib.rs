use serde::Serialize;
use serde_json::{Map, Value};
use std::env;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallStatus {
    installed: bool,
    configured: bool,
    has_api_key: bool,
    verified: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionConfig {
    mode: String,
    remote_url: String,
    api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfig {
    provider: String,
    model: String,
    base_url: String,
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn hermes_home() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".hermes")
}

fn profile_home(profile: Option<&str>) -> PathBuf {
    match profile {
        Some(name) if !name.is_empty() && name != "default" => {
            hermes_home().join("profiles").join(name)
        }
        _ => hermes_home(),
    }
}

fn safe_write(path: PathBuf, content: String) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn desktop_config_path() -> PathBuf {
    hermes_home().join("desktop.json")
}

fn read_desktop_config() -> Map<String, Value> {
    let path = desktop_config_path();
    let Ok(content) = fs::read_to_string(path) else {
        return Map::new();
    };

    serde_json::from_str::<Value>(&content)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_desktop_config(data: Map<String, Value>) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    safe_write(desktop_config_path(), content)
}

fn env_has_any(keys: &[&str]) -> bool {
    keys.iter().any(|key| env::var_os(key).is_some())
}

fn parse_env_content(content: &str) -> Map<String, Value> {
    let mut values = Map::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || !trimmed.contains('=') {
            continue;
        }

        let Some((key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }

        let mut value = raw_value.trim().to_string();
        if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value = value[1..value.len() - 1].to_string();
        }

        if !value.is_empty() {
            values.insert(key.to_string(), Value::String(value));
        }
    }
    values
}

fn read_yaml_scalar(content: &str, key: &str) -> Option<String> {
    let pattern = format!(
        r#"(?m)^\s*{}:[ \t]*["']?([^"'\n#]+)["']?"#,
        regex::escape(key)
    );
    regex::Regex::new(&pattern)
        .ok()?
        .captures(content)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().trim().to_string())
}

fn set_yaml_scalar(content: String, key: &str, value: &str) -> String {
    let pattern = format!(
        r#"(?m)^(\s*#?\s*{}:\s*)["']?[^"'\n#]*["']?"#,
        regex::escape(key)
    );
    let Ok(re) = regex::Regex::new(&pattern) else {
        return content;
    };
    if !re.is_match(&content) {
        return content;
    }
    re.replace(&content, format!("$1\"{}\"", value)).to_string()
}

fn upsert_model_block(content: String, provider: &str, model: &str, base_url: &str) -> String {
    let mut lines = content
        .split('\n')
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let Some(model_start) = lines.iter().position(|line| {
        regex::Regex::new(r"^model:\s*(?:#.*)?$")
            .unwrap()
            .is_match(line)
    }) else {
        let prefix = content.trim_end();
        let separator = if prefix.is_empty() { "" } else { "\n\n" };
        return format!(
            "{prefix}{separator}model:\n  provider: \"{provider}\"\n  default: \"{model}\"\n  base_url: \"{base_url}\"\n"
        );
    };

    let mut model_end = lines.len();
    for (i, line) in lines.iter().enumerate().skip(model_start + 1) {
        if !line.trim().is_empty() && !line.starts_with(char::is_whitespace) {
            model_end = i;
            break;
        }
    }

    let field_re = regex::Regex::new(r"^(\s*)(provider|default|model|base_url):").unwrap();
    let mut seen = std::collections::HashSet::new();
    for line in lines.iter_mut().take(model_end).skip(model_start + 1) {
        let Some(captures) = field_re.captures(line) else {
            continue;
        };
        let indent = captures.get(1).map(|m| m.as_str()).unwrap_or("  ");
        let source_key = captures.get(2).map(|m| m.as_str()).unwrap_or("");
        let desired_key = if source_key == "model" {
            "default"
        } else {
            source_key
        };
        let desired_value = match desired_key {
            "provider" => provider,
            "default" => model,
            "base_url" => base_url,
            _ => continue,
        };
        seen.insert(desired_key.to_string());
        *line = format!("{indent}{source_key}: \"{desired_value}\"");
    }

    let mut missing = Vec::new();
    for key in ["provider", "default", "base_url"] {
        if !seen.contains(key) {
            let value = match key {
                "provider" => provider,
                "default" => model,
                "base_url" => base_url,
                _ => "",
            };
            missing.push(format!("  {key}: \"{value}\""));
        }
    }
    lines.splice(model_end..model_end, missing);
    lines.join("\n")
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn check_install() -> InstallStatus {
    let home = hermes_home();
    let has_api_key = env_has_any(&[
        "MINIMAX_API_KEY",
        "MINIMAX_CN_API_KEY",
        "OPENAI_API_KEY",
        "CAI_API_KEY",
        "DASHSCOPE_API_KEY",
        "OPENROUTER_API_KEY",
    ]);

    InstallStatus {
        installed: home.exists(),
        configured: home.join("config.yaml").exists() || has_api_key,
        has_api_key,
        verified: home.exists(),
    }
}

#[tauri::command]
fn get_env(profile: Option<String>) -> Result<Map<String, Value>, String> {
    let env_file = profile_home(profile.as_deref()).join(".env");
    let Ok(content) = fs::read_to_string(env_file) else {
        return Ok(Map::new());
    };
    Ok(parse_env_content(&content))
}

#[tauri::command]
fn set_env(key: String, value: String, profile: Option<String>) -> Result<bool, String> {
    let env_file = profile_home(profile.as_deref()).join(".env");
    let mut lines = fs::read_to_string(&env_file)
        .unwrap_or_default()
        .split('\n')
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    let assignment_re = regex::Regex::new(&format!(r#"^#?\s*{}\s*="#, regex::escape(&key)))
        .map_err(|error| error.to_string())?;

    let mut found = false;
    for line in &mut lines {
        if assignment_re.is_match(line.trim()) {
            *line = format!("{key}={value}");
            found = true;
            break;
        }
    }

    if !found {
        if lines.len() == 1 && lines[0].is_empty() {
            lines[0] = format!("{key}={value}");
        } else {
            lines.push(format!("{key}={value}"));
        }
    }

    safe_write(env_file, format!("{}\n", lines.join("\n")))?;
    Ok(true)
}

#[tauri::command]
fn get_config(key: String, profile: Option<String>) -> Result<Option<String>, String> {
    let config_file = profile_home(profile.as_deref()).join("config.yaml");
    let Ok(content) = fs::read_to_string(config_file) else {
        return Ok(None);
    };
    Ok(read_yaml_scalar(&content, &key))
}

#[tauri::command]
fn set_config(key: String, value: String, profile: Option<String>) -> Result<bool, String> {
    let config_file = profile_home(profile.as_deref()).join("config.yaml");
    let Ok(content) = fs::read_to_string(&config_file) else {
        return Ok(false);
    };
    safe_write(config_file, set_yaml_scalar(content, &key, &value))?;
    Ok(true)
}

#[tauri::command]
fn get_hermes_home(_profile: Option<String>) -> String {
    profile_home(_profile.as_deref())
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn get_connection_config() -> ConnectionConfig {
    let data = read_desktop_config();
    ConnectionConfig {
        mode: data
            .get("connectionMode")
            .and_then(Value::as_str)
            .unwrap_or("local")
            .to_string(),
        remote_url: data
            .get("remoteUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        api_key: data
            .get("remoteApiKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    }
}

#[tauri::command]
fn is_remote_mode() -> bool {
    let config = get_connection_config();
    config.mode == "remote" && !config.remote_url.is_empty()
}

#[tauri::command]
fn set_connection_config(
    mode: String,
    remote_url: String,
    api_key: Option<String>,
) -> Result<bool, String> {
    let mut data = read_desktop_config();
    data.insert("connectionMode".to_string(), Value::String(mode));
    data.insert("remoteUrl".to_string(), Value::String(remote_url));
    data.insert(
        "remoteApiKey".to_string(),
        Value::String(api_key.unwrap_or_default()),
    );
    write_desktop_config(data)?;
    Ok(true)
}

#[tauri::command]
fn test_remote_connection(url: String, _api_key: Option<String>) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

#[tauri::command]
fn get_model_config(_profile: Option<String>) -> ModelConfig {
    let config_file = profile_home(_profile.as_deref()).join("config.yaml");
    let Ok(content) = fs::read_to_string(config_file) else {
        return ModelConfig {
            provider: "auto".to_string(),
            model: String::new(),
            base_url: String::new(),
        };
    };

    ModelConfig {
        provider: read_yaml_scalar(&content, "provider").unwrap_or_else(|| "auto".to_string()),
        model: read_yaml_scalar(&content, "default")
            .or_else(|| read_yaml_scalar(&content, "model"))
            .unwrap_or_default(),
        base_url: read_yaml_scalar(&content, "base_url").unwrap_or_default(),
    }
}

#[tauri::command]
fn set_model_config(
    provider: String,
    model: String,
    base_url: String,
    profile: Option<String>,
) -> Result<bool, String> {
    let config_file = profile_home(profile.as_deref()).join("config.yaml");
    let content = fs::read_to_string(&config_file).unwrap_or_default();
    let mut next = upsert_model_block(content, &provider, &model, &base_url);

    if let Ok(streaming_re) = regex::Regex::new(r"(?m)^(\s*streaming:\s*)(\S+)") {
        if streaming_re.is_match(&next) {
            next = streaming_re.replace(&next, "${1}true").to_string();
        }
    }

    safe_write(config_file, next)?;
    Ok(true)
}

#[tauri::command]
fn get_hermes_version() -> Option<String> {
    None
}

#[tauri::command]
fn get_locale() -> String {
    "en".to_string()
}

#[tauri::command]
fn set_locale(locale: String) -> String {
    locale
}

#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|error| error.to_string()),
        _ => Err("Blocked unsupported URL protocol".to_string()),
    }
}

#[tauri::command]
async fn open_local_path(app: AppHandle, path: String) -> Result<bool, String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reveal_local_path(app: AppHandle, path: String) -> Result<bool, String> {
    app.opener()
        .reveal_item_in_dir(path)
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn abort_chat() {}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            abort_chat,
            check_install,
            get_config,
            get_env,
            get_app_version,
            get_connection_config,
            get_hermes_home,
            get_hermes_version,
            get_locale,
            get_model_config,
            is_remote_mode,
            open_external,
            open_local_path,
            reveal_local_path,
            set_config,
            set_connection_config,
            set_env,
            set_locale,
            set_model_config,
            test_remote_connection,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("80m Agent Desktop");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running 80m Agent Desktop");
}
