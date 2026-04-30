use once_cell::sync::Lazy;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use rusqlite::Connection;
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

const LOCAL_API_URL: &str = "http://127.0.0.1:8642";
static GATEWAY_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
static CLAW3D_DEV_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
static CLAW3D_ADAPTER_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
static CLAW3D_DEV_LOGS: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static CLAW3D_ADAPTER_LOGS: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static CLAW3D_DEV_ERROR: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static CLAW3D_ADAPTER_ERROR: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
const HERMES_OFFICE_REPO: &str = "https://github.com/fathah/hermes-office";
const DEFAULT_CLAW3D_PORT: i64 = 3000;
const DEFAULT_CLAW3D_WS_URL: &str = "ws://localhost:18789";

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

#[derive(Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatResponse {
    response: String,
    session_id: Option<String>,
}

#[derive(Serialize)]
struct ToolsetInfo {
    key: String,
    label: String,
    description: String,
    enabled: bool,
}

#[derive(Serialize)]
struct InstalledSkill {
    name: String,
    category: String,
    description: String,
    path: String,
}

#[derive(Serialize)]
struct SkillSearchResult {
    name: String,
    description: String,
    category: String,
    source: String,
    installed: bool,
}

#[derive(Serialize)]
struct ActionResult {
    success: bool,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummary {
    id: String,
    source: String,
    started_at: f64,
    ended_at: Option<f64>,
    message_count: i64,
    model: String,
    title: Option<String>,
    preview: String,
}

#[derive(Serialize)]
struct SessionMessage {
    id: i64,
    role: String,
    content: String,
    timestamp: f64,
    tool_calls: Option<String>,
    tool_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    session_id: String,
    title: Option<String>,
    started_at: f64,
    source: String,
    message_count: i64,
    model: String,
    snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileInfo {
    name: String,
    path: String,
    is_default: bool,
    is_active: bool,
    model: String,
    provider: String,
    has_env: bool,
    has_soul: bool,
    skill_count: usize,
    gateway_running: bool,
}

#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    is_directory: bool,
    path: String,
}

#[derive(Serialize)]
struct LogContent {
    content: String,
    path: String,
}

#[derive(Serialize)]
struct Claw3dStatus {
    cloned: bool,
    installed: bool,
    #[serde(rename = "devServerRunning")]
    dev_server_running: bool,
    #[serde(rename = "adapterRunning")]
    adapter_running: bool,
    port: i64,
    #[serde(rename = "portInUse")]
    port_in_use: bool,
    #[serde(rename = "wsUrl")]
    ws_url: String,
    running: bool,
    error: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedModel {
    id: String,
    name: String,
    provider: String,
    model: String,
    base_url: String,
    created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogModel {
    provider: String,
    model: String,
    name: String,
    description: String,
    base_url: String,
    source: String,
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

fn hermes_home() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".hermes")
}

fn hermes_repo() -> PathBuf {
    hermes_home().join("hermes-agent")
}

fn hermes_python() -> PathBuf {
    hermes_repo().join("venv").join("bin").join("python")
}

fn hermes_script() -> PathBuf {
    hermes_repo().join("hermes")
}

fn enhanced_path() -> String {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut parts = vec![
        home.join(".local")
            .join("bin")
            .to_string_lossy()
            .to_string(),
        home.join(".cargo")
            .join("bin")
            .to_string_lossy()
            .to_string(),
        hermes_repo()
            .join("venv")
            .join("bin")
            .to_string_lossy()
            .to_string(),
        "/usr/local/bin".to_string(),
    ];
    parts.push(env::var("PATH").unwrap_or_default());
    parts.join(":")
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

fn file_info(path: PathBuf) -> Value {
    match fs::metadata(&path) {
        Ok(metadata) => serde_json::json!({
            "content": fs::read_to_string(&path).unwrap_or_default(),
            "exists": true,
            "lastModified": metadata.modified().ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64),
        }),
        Err(_) => serde_json::json!({
            "content": "",
            "exists": false,
            "lastModified": Value::Null,
        }),
    }
}

fn env_map(profile: Option<&str>) -> Map<String, Value> {
    let env_file = profile_home(profile).join(".env");
    let Ok(content) = fs::read_to_string(env_file) else {
        return Map::new();
    };
    parse_env_content(&content)
}

fn env_string(profile: Option<&str>, key: &str) -> Option<String> {
    env_map(profile)
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| env::var(key).ok())
        .filter(|value| !value.trim().is_empty())
}

fn api_url() -> String {
    let config = get_connection_config();
    if config.mode == "remote" && !config.remote_url.is_empty() {
        return config.remote_url.trim_end_matches('/').to_string();
    }
    LOCAL_API_URL.to_string()
}

fn api_auth(profile: Option<&str>) -> Option<String> {
    let config = get_connection_config();
    if config.mode == "remote" && !config.api_key.is_empty() {
        return Some(config.api_key);
    }
    if config.mode == "local" {
        return env_string(profile, "API_SERVER_KEY");
    }
    None
}

fn ensure_api_server_key(profile: Option<&str>) -> Result<String, String> {
    if let Some(key) = env_string(profile, "API_SERVER_KEY") {
        return Ok(key);
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let key = format!("hsk_{stamp:x}_{}", std::process::id());
    set_env(
        "API_SERVER_KEY".to_string(),
        key.clone(),
        profile.map(ToString::to_string),
    )?;
    Ok(key)
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

fn read_pid_file() -> Option<u32> {
    let content = fs::read_to_string(hermes_home().join("gateway.pid")).ok()?;
    let trimmed = content.trim();
    if trimmed.starts_with('{') {
        serde_json::from_str::<Value>(trimmed)
            .ok()?
            .get("pid")?
            .as_u64()
            .map(|pid| pid as u32)
    } else {
        trimmed.parse::<u32>().ok()
    }
}

fn process_is_alive(pid: u32) -> bool {
    Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn gateway_running_internal() -> bool {
    if let Ok(mut guard) = GATEWAY_PROCESS.lock() {
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                }
                Ok(None) => return true,
                Err(_) => {
                    *guard = None;
                }
            }
        }
    }

    read_pid_file().map(process_is_alive).unwrap_or(false)
}

async fn api_ready(profile: Option<&str>) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1800))
        .build();
    let Ok(client) = client else {
        return false;
    };
    let mut req = client.get(format!("{}/health", api_url()));
    if let Some(key) = api_auth(profile) {
        req = req.header(AUTHORIZATION, format!("Bearer {key}"));
    }
    req.send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn gateway_env(profile: Option<&str>, api_key: &str) -> HashMap<String, String> {
    let mut values = env::vars().collect::<HashMap<_, _>>();
    values.insert("PATH".to_string(), enhanced_path());
    values.insert(
        "HOME".to_string(),
        home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .to_string_lossy()
            .to_string(),
    );
    values.insert(
        "HERMES_HOME".to_string(),
        hermes_home().to_string_lossy().to_string(),
    );
    values.insert("API_SERVER_ENABLED".to_string(), "true".to_string());
    values.insert("API_SERVER_KEY".to_string(), api_key.to_string());

    for (key, value) in env_map(profile) {
        if let Some(value) = value.as_str() {
            if !value.is_empty() {
                values.insert(key, value.to_string());
            }
        }
    }
    values
}

fn strip_ansi(text: &str) -> String {
    let Ok(re) = regex::Regex::new(r"\x1B\[[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B\(B|\r") else {
        return text.to_string();
    };
    re.replace_all(text, "").to_string()
}

fn hermes_office_dir() -> PathBuf {
    hermes_home().join("hermes-office")
}

fn claw3d_dev_pid_file() -> PathBuf {
    hermes_home().join("claw3d-dev.pid")
}

fn claw3d_adapter_pid_file() -> PathBuf {
    hermes_home().join("claw3d-adapter.pid")
}

fn claw3d_port_file() -> PathBuf {
    hermes_home().join("claw3d-port")
}

fn claw3d_ws_url_file() -> PathBuf {
    hermes_home().join("claw3d-ws-url")
}

fn claw3d_settings_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".openclaw")
        .join("claw3d")
}

fn read_pid(path: PathBuf) -> Option<u32> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| content.trim().parse::<u32>().ok())
}

fn write_pid(path: PathBuf, pid: u32) {
    let _ = safe_write(path, pid.to_string());
}

fn cleanup_pid(path: PathBuf) {
    let _ = fs::remove_file(path);
}

fn saved_claw3d_port() -> i64 {
    fs::read_to_string(claw3d_port_file())
        .ok()
        .and_then(|content| content.trim().parse::<i64>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_CLAW3D_PORT)
}

fn saved_claw3d_ws_url() -> String {
    fs::read_to_string(claw3d_ws_url_file())
        .ok()
        .map(|content| content.trim().to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| DEFAULT_CLAW3D_WS_URL.to_string())
}

fn write_claw3d_settings(ws_url: Option<String>) {
    let url = ws_url.unwrap_or_else(saved_claw3d_ws_url);

    let settings_dir = claw3d_settings_dir();
    let settings_path = settings_dir.join("settings.json");
    let mut settings = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    settings.insert("adapter".to_string(), Value::String("hermes".to_string()));
    settings.insert("url".to_string(), Value::String(url.clone()));
    settings.insert("token".to_string(), Value::String(String::new()));
    let _ = safe_write(
        settings_path,
        serde_json::to_string_pretty(&Value::Object(settings)).unwrap_or_default(),
    );

    let office_dir = hermes_office_dir();
    if office_dir.exists() {
        let env_content = [
            "# Auto-configured by Hermes Desktop".to_string(),
            format!("PORT={}", saved_claw3d_port()),
            "HOST=127.0.0.1".to_string(),
            format!("NEXT_PUBLIC_GATEWAY_URL={url}"),
            format!("CLAW3D_GATEWAY_URL={url}"),
            "CLAW3D_GATEWAY_TOKEN=".to_string(),
            "HERMES_ADAPTER_PORT=18789".to_string(),
            "HERMES_MODEL=hermes".to_string(),
            "HERMES_AGENT_NAME=Hermes".to_string(),
            String::new(),
        ]
        .join("\n");
        let _ = safe_write(office_dir.join(".env"), env_content);
    }
}

fn claw3d_port_in_use(port: i64) -> bool {
    let Ok(port) = u16::try_from(port) else {
        return false;
    };
    let Ok(addr) = format!("127.0.0.1:{port}").parse() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn child_running(slot: &Lazy<Mutex<Option<Child>>>) -> bool {
    if let Ok(mut guard) = slot.lock() {
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                }
                Ok(None) => return true,
                Err(_) => {
                    *guard = None;
                }
            }
        }
    }
    false
}

fn claw3d_dev_running() -> bool {
    if child_running(&CLAW3D_DEV_PROCESS) {
        return true;
    }
    let pid_file = claw3d_dev_pid_file();
    if read_pid(pid_file.clone())
        .map(process_is_alive)
        .unwrap_or(false)
    {
        return true;
    }
    cleanup_pid(pid_file);
    false
}

fn claw3d_adapter_running() -> bool {
    if child_running(&CLAW3D_ADAPTER_PROCESS) {
        return true;
    }
    let pid_file = claw3d_adapter_pid_file();
    if read_pid(pid_file.clone())
        .map(process_is_alive)
        .unwrap_or(false)
    {
        return true;
    }
    cleanup_pid(pid_file);
    false
}

fn find_npm() -> String {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    let mut candidates = vec![
        home.join(".volta").join("bin").join("npm"),
        home.join(".asdf").join("shims").join("npm"),
        home.join(".local")
            .join("share")
            .join("fnm")
            .join("aliases")
            .join("default")
            .join("bin")
            .join("npm"),
        home.join(".fnm")
            .join("aliases")
            .join("default")
            .join("bin")
            .join("npm"),
        PathBuf::from("/usr/local/bin/npm"),
        PathBuf::from("/opt/homebrew/bin/npm"),
        PathBuf::from("/usr/bin/npm"),
    ];

    let nvm_versions = env::var("NVM_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join(".nvm"))
        .join("versions")
        .join("node");
    if let Ok(entries) = fs::read_dir(nvm_versions) {
        let mut versions = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with('v'))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        versions.sort();
        versions.reverse();
        candidates.splice(
            0..0,
            versions
                .into_iter()
                .map(|path| path.join("bin").join("npm")),
        );
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "npm".to_string())
}

fn append_limited(target: &Lazy<Mutex<String>>, chunk: &str) {
    if let Ok(mut logs) = target.lock() {
        logs.push_str(chunk);
        if logs.len() > 2000 {
            let keep_from = logs.len().saturating_sub(2000);
            *logs = logs[keep_from..].to_string();
        }
    }
}

fn set_error(target: &Lazy<Mutex<String>>, text: &str) {
    if text.is_empty() {
        return;
    }
    if regex::Regex::new("(?i)error|EADDRINUSE|ENOENT|failed|fatal")
        .map(|re| re.is_match(text))
        .unwrap_or(false)
        && !regex::Regex::new("(?i)warning")
            .map(|re| re.is_match(text))
            .unwrap_or(false)
    {
        if let Ok(mut error) = target.lock() {
            *error = text.trim().chars().take(300).collect();
        }
    }
}

fn clear_logs(logs: &Lazy<Mutex<String>>, error: &Lazy<Mutex<String>>) {
    if let Ok(mut logs) = logs.lock() {
        logs.clear();
    }
    if let Ok(mut error) = error.lock() {
        error.clear();
    }
}

fn spawn_log_reader<R>(
    reader: R,
    logs: &'static Lazy<Mutex<String>>,
    error: &'static Lazy<Mutex<String>>,
) where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines().map_while(Result::ok) {
            let text = strip_ansi(&(line + "\n"));
            append_limited(logs, &text);
            set_error(error, &text);
        }
    });
}

fn stop_pid(pid_file: PathBuf) {
    if let Some(pid) = read_pid(pid_file.clone()) {
        let pid_text = pid.to_string();
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(format!("-{pid}"))
            .status();
        let _ = Command::new("kill").arg("-TERM").arg(pid_text).status();
    }
    cleanup_pid(pid_file);
}

fn start_claw3d_process(
    args: &[&str],
    slot: &'static Lazy<Mutex<Option<Child>>>,
    logs: &'static Lazy<Mutex<String>>,
    error: &'static Lazy<Mutex<String>>,
    pid_file: PathBuf,
    extra_env: &[(&str, String)],
) -> bool {
    let office_dir = hermes_office_dir();
    if !office_dir.join("node_modules").exists() {
        return false;
    }
    if child_running(slot)
        || read_pid(pid_file.clone())
            .map(process_is_alive)
            .unwrap_or(false)
    {
        return true;
    }

    clear_logs(logs, error);
    let mut command = Command::new(find_npm());
    command
        .args(args)
        .current_dir(office_dir)
        .env("PATH", enhanced_path())
        .env(
            "HOME",
            home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .to_string(),
        )
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in extra_env {
        command.env(key, value);
    }

    let Ok(mut child) = command.spawn() else {
        if let Ok(mut err) = error.lock() {
            *err = "Failed to start Claw3D process".to_string();
        }
        return false;
    };

    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(stdout, logs, error);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, logs, error);
    }
    write_pid(pid_file, child.id());
    if let Ok(mut guard) = slot.lock() {
        *guard = Some(child);
    }
    true
}

const TOOLSET_DEFS: &[(&str, &str, &str)] = &[
    (
        "web",
        "Web Search",
        "Search the web and extract content from URLs",
    ),
    (
        "browser",
        "Browser",
        "Navigate, click, type, and interact with web pages",
    ),
    ("terminal", "Terminal", "Execute shell commands and scripts"),
    (
        "file",
        "File Operations",
        "Read, write, search, and manage files",
    ),
    (
        "code_execution",
        "Code Execution",
        "Execute Python and shell code directly",
    ),
    ("vision", "Vision", "Analyze images and visual content"),
    (
        "image_gen",
        "Image Generation",
        "Generate images with DALL-E and other models",
    ),
    ("tts", "Text-to-Speech", "Convert text to spoken audio"),
    (
        "skills",
        "Skills",
        "Create, manage, and execute reusable skills",
    ),
    ("memory", "Memory", "Store and recall persistent knowledge"),
    (
        "session_search",
        "Session Search",
        "Search across past conversations",
    ),
    (
        "clarify",
        "Clarifying Questions",
        "Ask the user for clarification when needed",
    ),
    (
        "delegation",
        "Delegation",
        "Spawn sub-agents for parallel tasks",
    ),
    ("cronjob", "Cron Jobs", "Create and manage scheduled tasks"),
    (
        "moa",
        "Mixture of Agents",
        "Coordinate multiple AI models together",
    ),
    (
        "todo",
        "Task Planning",
        "Create and manage to-do lists for complex tasks",
    ),
];

fn parse_enabled_toolsets(content: &str) -> std::collections::HashSet<String> {
    let mut enabled = std::collections::HashSet::new();
    let mut in_platform_toolsets = false;
    let mut in_cli = false;

    for line in content.lines() {
        let trimmed = line.trim_end();
        if regex::Regex::new(r"^\s*platform_toolsets\s*:")
            .unwrap()
            .is_match(trimmed)
        {
            in_platform_toolsets = true;
            in_cli = false;
            continue;
        }
        if in_platform_toolsets && regex::Regex::new(r"^\s+cli\s*:").unwrap().is_match(trimmed) {
            in_cli = true;
            continue;
        }
        if in_platform_toolsets && !trimmed.is_empty() && !trimmed.starts_with(char::is_whitespace)
        {
            in_platform_toolsets = false;
            in_cli = false;
            continue;
        }
        if in_cli {
            if let Some(captures) = regex::Regex::new(r#"^\s+-\s+["']?(\w+)["']?"#)
                .unwrap()
                .captures(trimmed)
            {
                if let Some(value) = captures.get(1) {
                    enabled.insert(value.as_str().to_string());
                }
            }
        }
    }
    enabled
}

fn session_stats(profile: Option<&str>) -> (i64, i64) {
    let db_path = profile_home(profile).join("state.db");
    if !db_path.exists() {
        return (0, 0);
    }
    let Ok(db) = Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return (0, 0);
    };
    let sessions = db
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap_or(0);
    let messages = db
        .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
        .unwrap_or(0);
    (sessions, messages)
}

fn count_installed_skills(home: &PathBuf) -> usize {
    list_installed_skill_dir(home.join("skills")).len()
}

fn active_profile_name() -> String {
    fs::read_to_string(hermes_home().join("active_profile"))
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "default".to_string())
}

fn profile_info(name: String, path: PathBuf, is_default: bool, active_name: &str) -> ProfileInfo {
    let content = fs::read_to_string(path.join("config.yaml")).unwrap_or_default();
    ProfileInfo {
        name: name.clone(),
        path: path.to_string_lossy().to_string(),
        is_default,
        is_active: active_name == name,
        model: read_yaml_scalar(&content, "default")
            .or_else(|| read_yaml_scalar(&content, "model"))
            .unwrap_or_default(),
        provider: read_yaml_scalar(&content, "provider").unwrap_or_else(|| "auto".to_string()),
        has_env: path.join(".env").exists(),
        has_soul: path.join("SOUL.md").exists(),
        skill_count: count_installed_skills(&path),
        gateway_running: path
            .join("gateway.pid")
            .exists()
            .then(|| {
                fs::read_to_string(path.join("gateway.pid"))
                    .ok()
                    .and_then(|raw| raw.trim().parse::<u32>().ok())
                    .map(process_is_alive)
                    .unwrap_or(false)
            })
            .unwrap_or(false),
    }
}

fn command_result(mut command: Command) -> ActionResult {
    match command.output() {
        Ok(output) if output.status.success() => ActionResult {
            success: true,
            error: None,
        },
        Ok(output) => ActionResult {
            success: false,
            error: Some(
                strip_ansi(&String::from_utf8_lossy(&output.stderr))
                    .trim()
                    .to_string(),
            ),
        },
        Err(error) => ActionResult {
            success: false,
            error: Some(error.to_string()),
        },
    }
}

fn localize_tools(enabled: &dyn Fn(&str) -> bool) -> Vec<ToolsetInfo> {
    TOOLSET_DEFS
        .iter()
        .map(|(key, label, description)| ToolsetInfo {
            key: (*key).to_string(),
            label: (*label).to_string(),
            description: (*description).to_string(),
            enabled: enabled(key),
        })
        .collect()
}

fn parse_skill_frontmatter(content: &str, fallback: &str) -> (String, String) {
    if content.starts_with("---") {
        if let Some(end_idx) = content[3..].find("---").map(|idx| idx + 3) {
            let frontmatter = &content[3..end_idx];
            let name = regex::Regex::new(r#"(?m)^\s*name:\s*["']?([^"'\n]+)["']?\s*$"#)
                .ok()
                .and_then(|re| re.captures(frontmatter))
                .and_then(|captures| captures.get(1))
                .map(|value| value.as_str().trim().to_string())
                .unwrap_or_else(|| fallback.to_string());
            let description =
                regex::Regex::new(r#"(?m)^\s*description:\s*["']?([^"'\n]+)["']?\s*$"#)
                    .ok()
                    .and_then(|re| re.captures(frontmatter))
                    .and_then(|captures| captures.get(1))
                    .map(|value| value.as_str().trim().to_string())
                    .unwrap_or_default();
            return (name, description);
        }
    }

    let name = regex::Regex::new(r"(?m)^#\s+(.+)")
        .ok()
        .and_then(|re| re.captures(content))
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().trim().to_string())
        .unwrap_or_else(|| fallback.to_string());
    (name, String::new())
}

fn list_skill_dir(base_dir: PathBuf, bundled: bool) -> Vec<SkillSearchResult> {
    let mut skills = Vec::new();
    let Ok(categories) = fs::read_dir(base_dir) else {
        return skills;
    };
    for category in categories.flatten() {
        let category_path = category.path();
        if !category_path.is_dir() {
            continue;
        }
        let category_name = category.file_name().to_string_lossy().to_string();
        let Ok(entries) = fs::read_dir(category_path) else {
            continue;
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }
            let skill_file = entry_path.join("SKILL.md");
            if !skill_file.exists() {
                continue;
            }
            let fallback = entry.file_name().to_string_lossy().to_string();
            let content = fs::read_to_string(skill_file).unwrap_or_default();
            let preview = content.chars().take(4000).collect::<String>();
            let (name, description) = parse_skill_frontmatter(&preview, &fallback);
            skills.push(SkillSearchResult {
                name,
                description,
                category: category_name.clone(),
                source: if bundled { "bundled" } else { "installed" }.to_string(),
                installed: !bundled,
            });
        }
    }
    skills.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    skills
}

fn list_installed_skill_dir(base_dir: PathBuf) -> Vec<InstalledSkill> {
    let mut skills = Vec::new();
    let Ok(categories) = fs::read_dir(base_dir) else {
        return skills;
    };
    for category in categories.flatten() {
        let category_path = category.path();
        if !category_path.is_dir() {
            continue;
        }
        let category_name = category.file_name().to_string_lossy().to_string();
        let Ok(entries) = fs::read_dir(category_path) else {
            continue;
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }
            let skill_file = entry_path.join("SKILL.md");
            if !skill_file.exists() {
                continue;
            }
            let fallback = entry.file_name().to_string_lossy().to_string();
            let content = fs::read_to_string(skill_file).unwrap_or_default();
            let preview = content.chars().take(4000).collect::<String>();
            let (name, description) = parse_skill_frontmatter(&preview, &fallback);
            skills.push(InstalledSkill {
                name,
                category: category_name.clone(),
                description,
                path: entry_path.to_string_lossy().to_string(),
            });
        }
    }
    skills.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    skills
}

fn emit_chat_error(app: &AppHandle, error: &str) {
    let _ = app.emit("chat-error", error);
}

fn emit_chat_done(app: &AppHandle, session_id: Option<&str>) {
    let _ = app.emit("chat-done", session_id.unwrap_or(""));
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn default_models() -> Vec<SavedModel> {
    [
        ("MiniMax M2.7", "nous", "minimax/minimax-m2.7", ""),
        ("OpenAI GPT-5.5", "nous", "openai/gpt-5.5", ""),
        ("xAI Grok 4.20 Beta", "nous", "x-ai/grok-4.20-beta", ""),
        ("Qwen3.5 Plus", "nous", "qwen/qwen3.5-plus-02-15", ""),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (name, provider, model, base_url))| SavedModel {
        id: format!("default-{index}-{model}"),
        name: name.to_string(),
        provider: provider.to_string(),
        model: model.to_string(),
        base_url: base_url.to_string(),
        created_at: now_ms(),
    })
    .collect()
}

fn models_file() -> PathBuf {
    hermes_home().join("models.json")
}

fn read_models_file() -> Vec<SavedModel> {
    let Ok(content) = fs::read_to_string(models_file()) else {
        return Vec::new();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn write_models_file(models: &[SavedModel]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(models).map_err(|error| error.to_string())?;
    safe_write(models_file(), content)
}

fn model_name_from_id(id: &str) -> String {
    id.split('/')
        .next_back()
        .unwrap_or(id)
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn fallback_catalog() -> Vec<CatalogModel> {
    default_models()
        .into_iter()
        .map(|model| CatalogModel {
            provider: model.provider,
            model: model.model,
            name: model.name,
            description: "fallback".to_string(),
            base_url: model.base_url,
            source: "fallback".to_string(),
        })
        .collect()
}

fn parse_catalog(raw: &Value) -> Vec<CatalogModel> {
    if raw.get("version").and_then(Value::as_i64) != Some(1) {
        return Vec::new();
    }
    let Some(providers) = raw.get("providers").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut models = Vec::new();
    for (provider, catalog) in providers {
        let Some(entries) = catalog.get("models").and_then(Value::as_array) else {
            continue;
        };
        for entry in entries {
            let Some(id) = entry.get("id").and_then(Value::as_str) else {
                continue;
            };
            models.push(CatalogModel {
                provider: provider.clone(),
                model: id.to_string(),
                name: model_name_from_id(id),
                description: entry
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                base_url: String::new(),
                source: "catalog".to_string(),
            });
        }
    }
    models
}

fn state_db() -> PathBuf {
    hermes_home().join("state.db")
}

fn open_state_db() -> Result<Option<Connection>, String> {
    let db_path = state_db();
    if !db_path.exists() {
        return Ok(None);
    }
    Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map(Some)
        .map_err(|error| error.to_string())
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
async fn start_gateway(profile: Option<String>) -> Result<bool, String> {
    if gateway_running_internal() {
        return Ok(false);
    }

    let api_key = ensure_api_server_key(profile.as_deref())?;
    let child = Command::new(hermes_python())
        .arg(hermes_script())
        .arg("gateway")
        .current_dir(hermes_repo())
        .envs(gateway_env(profile.as_deref(), &api_key))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;

    if let Ok(mut guard) = GATEWAY_PROCESS.lock() {
        *guard = Some(child);
    }

    Ok(true)
}

#[tauri::command]
fn gateway_status() -> bool {
    gateway_running_internal()
}

#[tauri::command]
fn stop_gateway() -> Result<bool, String> {
    if let Ok(mut guard) = GATEWAY_PROCESS.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
        *guard = None;
    }

    if let Some(pid) = read_pid_file() {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }

    let pid_file = hermes_home().join("gateway.pid");
    if pid_file.exists() {
        let _ = fs::remove_file(pid_file);
    }
    Ok(true)
}

fn build_chat_messages(
    message: &str,
    history: Option<Vec<ChatMessage>>,
    active_project: Option<String>,
) -> Vec<Value> {
    let mut messages = Vec::new();
    if let Some(project) = active_project.filter(|value| !value.is_empty()) {
        messages.push(serde_json::json!({
            "role": "system",
            "content": format!("The user has set the workspace directory to: {project}. All terminal and file commands should operate in or relative to this directory.")
        }));
    }

    for item in history.unwrap_or_default() {
        messages.push(serde_json::json!({
            "role": if item.role == "agent" { "assistant" } else { item.role.as_str() },
            "content": item.content,
        }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": message }));
    messages
}

async fn send_message_via_api(
    app: &AppHandle,
    message: &str,
    profile: Option<&str>,
    resume_session_id: Option<String>,
    history: Option<Vec<ChatMessage>>,
    active_project: Option<String>,
) -> Result<ChatResponse, String> {
    let mc = get_model_config(profile.map(ToString::to_string));
    let body = serde_json::json!({
        "model": if mc.model.is_empty() { "hermes-agent" } else { mc.model.as_str() },
        "messages": build_chat_messages(message, history, active_project),
        "stream": false,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| error.to_string())?;
    let mut req = client
        .post(format!("{}/v1/chat/completions", api_url()))
        .header(CONTENT_TYPE, "application/json")
        .json(&body);
    if let Some(key) = api_auth(profile) {
        req = req.header(AUTHORIZATION, format!("Bearer {key}"));
    }
    if let Some(session_id) = resume_session_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        req = req.header("X-Hermes-Session-ID", session_id);
    }

    let response = req.send().await.map_err(|error| error.to_string())?;
    let session_id = response
        .headers()
        .get("x-hermes-session-id")
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string)
        .or(resume_session_id);

    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let parsed = serde_json::from_str::<Value>(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let message = parsed
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or_else(|| text.as_str())
            .to_string();
        return Err(format!("API server returned {status}: {message}"));
    }

    if let Some(error_message) = parsed
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        return Err(error_message.to_string());
    }

    let content = parsed
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if content.is_empty() {
        return Err(
            "No response received from the model. Check your model configuration and API key."
                .to_string(),
        );
    }

    let _ = app.emit("chat-chunk", &content);
    emit_chat_done(app, session_id.as_deref());
    Ok(ChatResponse {
        response: content,
        session_id,
    })
}

fn send_message_via_cli(
    app: &AppHandle,
    message: &str,
    profile: Option<&str>,
    resume_session_id: Option<String>,
    active_project: Option<String>,
) -> Result<ChatResponse, String> {
    let mc = get_model_config(profile.map(ToString::to_string));
    let mut final_message = message.to_string();
    if let Some(project) = active_project.filter(|value| !value.is_empty()) {
        if resume_session_id.as_deref().unwrap_or("").is_empty() {
            final_message = format!(
                "[System: The user has set the workspace directory to: {project}]\n\n{message}"
            );
        }
    }

    let mut cmd = Command::new(hermes_python());
    cmd.arg(hermes_script());
    if let Some(profile_name) = profile.filter(|value| !value.is_empty() && *value != "default") {
        cmd.arg("-p").arg(profile_name);
    }
    cmd.args(["chat", "-q", &final_message, "-Q", "--source", "desktop"]);
    if let Some(session_id) = resume_session_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        cmd.arg("--resume").arg(session_id);
    }
    if !mc.model.is_empty() {
        cmd.arg("-m").arg(mc.model);
    }
    cmd.current_dir(hermes_repo())
        .env("PATH", enhanced_path())
        .env(
            "HOME",
            home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .to_string(),
        )
        .env("HERMES_HOME", hermes_home())
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in env_map(profile) {
        if let Some(value) = value.as_str() {
            cmd.env(key, value);
        }
    }

    let output = cmd.output().map_err(|error| error.to_string())?;
    let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi(&String::from_utf8_lossy(&output.stderr));
    let session_id = regex::Regex::new(r"session_id:\s*(\S+)")
        .ok()
        .and_then(|re| re.captures(&stdout))
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string());
    let cleaned = regex::Regex::new(r"session_id:\s*\S+\n?")
        .map(|re| re.replace_all(&stdout, "").to_string())
        .unwrap_or(stdout)
        .trim()
        .to_string();

    if output.status.success() || !cleaned.is_empty() {
        if !cleaned.is_empty() {
            let _ = app.emit("chat-chunk", &cleaned);
        }
        emit_chat_done(app, session_id.as_deref());
        Ok(ChatResponse {
            response: cleaned,
            session_id,
        })
    } else {
        let detail = stderr.trim();
        Err(if detail.is_empty() {
            "Hermes exited without a response. Check your model configuration and API key."
                .to_string()
        } else {
            detail.to_string()
        })
    }
}

#[tauri::command]
fn get_toolsets(profile: Option<String>) -> Vec<ToolsetInfo> {
    let config_file = profile_home(profile.as_deref()).join("config.yaml");
    let Ok(content) = fs::read_to_string(config_file) else {
        return localize_tools(&|_| true);
    };

    let enabled = parse_enabled_toolsets(&content);
    if enabled.is_empty() && !content.contains("platform_toolsets") {
        return localize_tools(&|_| true);
    }

    localize_tools(&|key| enabled.contains(key))
}

#[tauri::command]
fn set_toolset_enabled(
    key: String,
    enabled: bool,
    profile: Option<String>,
) -> Result<bool, String> {
    let config_file = profile_home(profile.as_deref()).join("config.yaml");
    let Ok(content) = fs::read_to_string(&config_file) else {
        return Ok(false);
    };

    let mut current = parse_enabled_toolsets(&content);
    if enabled {
        current.insert(key);
    } else {
        current.remove(&key);
    }

    let mut entries = current.into_iter().collect::<Vec<_>>();
    entries.sort();
    let toolset_lines = entries
        .iter()
        .map(|tool| format!("      - {tool}"))
        .collect::<Vec<_>>()
        .join("\n");
    let new_section = format!("  cli:\n{toolset_lines}");

    let next = if content.contains("platform_toolsets") {
        let lines = content.lines().map(ToString::to_string).collect::<Vec<_>>();
        let mut result = Vec::new();
        let mut in_platform_toolsets = false;
        let mut in_cli = false;
        let mut cli_inserted = false;

        for line in lines {
            let trimmed = line.trim_end();
            if regex::Regex::new(r"^\s*platform_toolsets\s*:")
                .unwrap()
                .is_match(trimmed)
            {
                in_platform_toolsets = true;
                result.push(line);
                continue;
            }

            if in_platform_toolsets && regex::Regex::new(r"^\s+cli\s*:").unwrap().is_match(trimmed)
            {
                in_cli = true;
                result.push(new_section.clone());
                cli_inserted = true;
                continue;
            }

            if in_cli {
                if regex::Regex::new(r"^\s+-\s").unwrap().is_match(trimmed) {
                    continue;
                }
                if regex::Regex::new(r"^\s{4}\S").unwrap().is_match(trimmed)
                    || (!trimmed.is_empty() && !trimmed.starts_with(char::is_whitespace))
                    || trimmed.is_empty()
                {
                    in_cli = false;
                    result.push(line);
                    continue;
                }
                continue;
            }

            if in_platform_toolsets
                && !trimmed.is_empty()
                && !trimmed.starts_with(char::is_whitespace)
            {
                in_platform_toolsets = false;
                if !cli_inserted {
                    result.push(new_section.clone());
                    cli_inserted = true;
                }
            }
            result.push(line);
        }

        if !cli_inserted {
            result.push(new_section);
        }
        result.join("\n")
    } else {
        format!(
            "{}\n\nplatform_toolsets:\n{}\n",
            content.trim_end(),
            new_section
        )
    };

    safe_write(config_file, next)?;
    Ok(true)
}

#[tauri::command]
fn list_installed_skills(profile: Option<String>) -> Vec<InstalledSkill> {
    list_installed_skill_dir(profile_home(profile.as_deref()).join("skills"))
}

#[tauri::command]
fn list_bundled_skills() -> Vec<SkillSearchResult> {
    list_skill_dir(hermes_repo().join("skills"), true)
}

#[tauri::command]
fn get_skill_content(skill_path: String) -> Result<String, String> {
    fs::read_to_string(PathBuf::from(skill_path).join("SKILL.md"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn install_skill(identifier: String, profile: Option<String>) -> ActionResult {
    let mut cmd = Command::new(hermes_python());
    cmd.arg(hermes_script());
    if let Some(profile_name) = profile
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "default")
    {
        cmd.arg("-p").arg(profile_name);
    }
    cmd.args(["skills", "install", &identifier, "--yes"])
        .current_dir(hermes_repo())
        .env("PATH", enhanced_path())
        .env("HERMES_HOME", hermes_home())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match cmd.output() {
        Ok(output) if output.status.success() => ActionResult {
            success: true,
            error: None,
        },
        Ok(output) => ActionResult {
            success: false,
            error: Some(
                strip_ansi(&String::from_utf8_lossy(&output.stderr))
                    .trim()
                    .to_string(),
            ),
        },
        Err(error) => ActionResult {
            success: false,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn uninstall_skill(name: String, profile: Option<String>) -> ActionResult {
    let mut cmd = Command::new(hermes_python());
    cmd.arg(hermes_script());
    if let Some(profile_name) = profile
        .as_deref()
        .filter(|value| !value.is_empty() && *value != "default")
    {
        cmd.arg("-p").arg(profile_name);
    }
    cmd.args(["skills", "uninstall", &name, "--yes"])
        .current_dir(hermes_repo())
        .env("PATH", enhanced_path())
        .env("HERMES_HOME", hermes_home())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match cmd.output() {
        Ok(output) if output.status.success() => ActionResult {
            success: true,
            error: None,
        },
        Ok(output) => ActionResult {
            success: false,
            error: Some(
                strip_ansi(&String::from_utf8_lossy(&output.stderr))
                    .trim()
                    .to_string(),
            ),
        },
        Err(error) => ActionResult {
            success: false,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn list_sessions(limit: Option<i64>, offset: Option<i64>) -> Result<Vec<SessionSummary>, String> {
    let Some(db) = open_state_db()? else {
        return Ok(Vec::new());
    };
    let mut stmt = db
        .prepare(
            "SELECT id, source, started_at, ended_at, message_count, model, title
             FROM sessions
             ORDER BY started_at DESC
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params![limit.unwrap_or(30), offset.unwrap_or(0)],
            |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    started_at: row.get(2)?,
                    ended_at: row.get(3)?,
                    message_count: row.get(4)?,
                    model: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    title: row.get(6)?,
                    preview: String::new(),
                })
            },
        )
        .map_err(|error| error.to_string())?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(row.map_err(|error| error.to_string())?);
    }
    Ok(sessions)
}

#[tauri::command]
fn get_session_messages(session_id: String) -> Result<Vec<SessionMessage>, String> {
    let Some(db) = open_state_db()? else {
        return Ok(Vec::new());
    };
    let mut stmt = db
        .prepare(
            "SELECT id, role, content, timestamp, tool_calls, tool_name
             FROM messages
             WHERE session_id = ?1 AND (content IS NOT NULL OR tool_calls IS NOT NULL)
             ORDER BY timestamp, id",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([session_id], |row| {
            Ok(SessionMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                timestamp: row.get(3)?,
                tool_calls: row.get(4)?,
                tool_name: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|error| error.to_string())?);
    }
    Ok(messages)
}

#[tauri::command]
fn search_sessions(query: String, limit: Option<i64>) -> Result<Vec<SearchResult>, String> {
    let Some(db) = open_state_db()? else {
        return Ok(Vec::new());
    };
    let table_exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages_fts')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .unwrap_or(false);
    if !table_exists {
        return Ok(Vec::new());
    }

    let sanitized = query
        .split_whitespace()
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{}\"*", word.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ");
    if sanitized.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = db
        .prepare(
            "SELECT DISTINCT
               m.session_id,
               s.title,
               s.started_at,
               s.source,
               s.message_count,
               s.model,
               snippet(messages_fts, 0, '<<', '>>', '...', 40) as snippet
             FROM messages_fts
             JOIN messages m ON m.id = messages_fts.rowid
             JOIN sessions s ON s.id = m.session_id
             WHERE messages_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![sanitized, limit.unwrap_or(20)], |row| {
            Ok(SearchResult {
                session_id: row.get(0)?,
                title: row.get(1)?,
                started_at: row.get(2)?,
                source: row.get(3)?,
                message_count: row.get(4)?,
                model: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                snippet: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        })
        .map_err(|error| error.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|error| error.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
fn list_models() -> Result<Vec<SavedModel>, String> {
    let mut models = read_models_file();
    if models.is_empty() {
        models = default_models();
        write_models_file(&models)?;
        return Ok(models);
    }

    let mut changed = false;
    for default_model in default_models() {
        if !models.iter().any(|model| {
            model.provider == default_model.provider && model.model == default_model.model
        }) {
            models.push(default_model);
            changed = true;
        }
    }
    if changed {
        write_models_file(&models)?;
    }
    Ok(models)
}

#[tauri::command]
async fn list_model_catalog() -> Vec<CatalogModel> {
    const CATALOG_URL: &str = "https://hermes-agent.nousresearch.com/docs/api/model-catalog.json";
    let cache_file = hermes_home().join("cache").join("model_catalog.json");

    if let Ok(content) = fs::read_to_string(&cache_file) {
        if let Ok(raw) = serde_json::from_str::<Value>(&content) {
            let cached = parse_catalog(&raw);
            if !cached.is_empty() {
                return cached;
            }
        }
    }

    if let Ok(response) = reqwest::get(CATALOG_URL).await {
        if response.status().is_success() {
            if let Ok(raw) = response.json::<Value>().await {
                let parsed = parse_catalog(&raw);
                if !parsed.is_empty() {
                    if let Ok(content) = serde_json::to_string_pretty(&raw) {
                        let _ = safe_write(cache_file, content);
                    }
                    return parsed;
                }
            }
        }
    }

    fallback_catalog()
}

#[tauri::command]
fn add_model(
    name: String,
    provider: String,
    model: String,
    base_url: String,
) -> Result<SavedModel, String> {
    let mut models = read_models_file();
    if let Some(existing) = models
        .iter()
        .find(|entry| entry.provider == provider && entry.model == model)
    {
        return Ok(existing.clone());
    }
    let entry = SavedModel {
        id: format!("model-{}-{}", now_ms(), models.len()),
        name,
        provider,
        model,
        base_url,
        created_at: now_ms(),
    };
    models.push(entry.clone());
    write_models_file(&models)?;
    Ok(entry)
}

#[tauri::command]
fn remove_model(id: String) -> Result<bool, String> {
    let models = read_models_file();
    let filtered = models
        .into_iter()
        .filter(|model| model.id != id)
        .collect::<Vec<_>>();
    let changed = filtered.len() != read_models_file().len();
    if changed {
        write_models_file(&filtered)?;
    }
    Ok(changed)
}

#[tauri::command]
fn update_model(id: String, fields: Map<String, Value>) -> Result<bool, String> {
    let mut models = read_models_file();
    let Some(model) = models.iter_mut().find(|model| model.id == id) else {
        return Ok(false);
    };
    if let Some(value) = fields.get("name").and_then(Value::as_str) {
        model.name = value.to_string();
    }
    if let Some(value) = fields.get("provider").and_then(Value::as_str) {
        model.provider = value.to_string();
    }
    if let Some(value) = fields.get("model").and_then(Value::as_str) {
        model.model = value.to_string();
    }
    if let Some(value) = fields
        .get("baseUrl")
        .or_else(|| fields.get("base_url"))
        .and_then(Value::as_str)
    {
        model.base_url = value.to_string();
    }
    write_models_file(&models)?;
    Ok(true)
}

#[tauri::command]
fn get_credential_pool() -> Result<Map<String, Value>, String> {
    let auth_file = hermes_home().join("auth.json");
    let Ok(content) = fs::read_to_string(auth_file) else {
        return Ok(Map::new());
    };
    let raw = serde_json::from_str::<Value>(&content).unwrap_or(Value::Null);
    Ok(raw
        .get("credential_pool")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
fn set_credential_pool(provider: String, entries: Vec<Value>) -> Result<bool, String> {
    let auth_file = hermes_home().join("auth.json");
    let mut raw = fs::read_to_string(&auth_file)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
        .unwrap_or_else(|| Value::Object(Map::new()));
    if !raw
        .get("credential_pool")
        .map(|value| value.is_object())
        .unwrap_or(false)
    {
        raw.as_object_mut()
            .unwrap()
            .insert("credential_pool".to_string(), Value::Object(Map::new()));
    }
    raw.get_mut("credential_pool")
        .and_then(Value::as_object_mut)
        .unwrap()
        .insert(provider, Value::Array(entries));
    safe_write(
        auth_file,
        serde_json::to_string_pretty(&raw).map_err(|error| error.to_string())?,
    )?;
    Ok(true)
}

#[tauri::command]
fn get_platform_enabled(profile: Option<String>) -> Result<Map<String, Value>, String> {
    let config_file = profile_home(profile.as_deref()).join("config.yaml");
    let Ok(content) = fs::read_to_string(config_file) else {
        return Ok(Map::new());
    };
    let mut result = Map::new();
    for platform in ["telegram", "discord", "slack", "whatsapp", "signal"] {
        let pattern = format!(
            r"(?m)^[ \t]+{}:\s*\n[ \t]+enabled:\s*(true|false)",
            regex::escape(platform)
        );
        let enabled = regex::Regex::new(&pattern)
            .ok()
            .and_then(|re| re.captures(&content))
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str() == "true")
            .unwrap_or(false);
        result.insert(platform.to_string(), Value::Bool(enabled));
    }
    Ok(result)
}

#[tauri::command]
fn set_platform_enabled(
    platform: String,
    enabled: bool,
    profile: Option<String>,
) -> Result<bool, String> {
    let config_file = profile_home(profile.as_deref()).join("config.yaml");
    let Ok(mut content) = fs::read_to_string(&config_file) else {
        return Ok(false);
    };
    let pattern = format!(
        r"(?m)^([ \t]+{}:\s*\n[ \t]+enabled:\s*)(?:true|false)",
        regex::escape(&platform)
    );
    if let Ok(re) = regex::Regex::new(&pattern) {
        if re.is_match(&content) {
            content = re.replace(&content, format!("$1{enabled}")).to_string();
        } else {
            content.push_str(&format!(
                "\nplatforms:\n  {platform}:\n    enabled: {enabled}\n"
            ));
        }
    }
    safe_write(config_file, content)?;
    Ok(true)
}

#[tauri::command]
fn list_profiles() -> Vec<ProfileInfo> {
    let active = active_profile_name();
    let mut profiles = vec![profile_info(
        "default".to_string(),
        hermes_home(),
        true,
        &active,
    )];
    let profiles_dir = hermes_home().join("profiles");
    if let Ok(entries) = fs::read_dir(profiles_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if !path.join("config.yaml").exists() && !path.join(".env").exists() {
                continue;
            }
            profiles.push(profile_info(
                entry.file_name().to_string_lossy().to_string(),
                path,
                false,
                &active,
            ));
        }
    }
    profiles
}

#[tauri::command]
fn create_profile(name: String, clone: bool) -> ActionResult {
    let mut cmd = Command::new(hermes_python());
    cmd.arg(hermes_script()).args(["profile", "create", &name]);
    if clone {
        cmd.arg("--clone");
    }
    cmd.current_dir(hermes_repo())
        .env("PATH", enhanced_path())
        .env("HERMES_HOME", hermes_home())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command_result(cmd)
}

#[tauri::command]
fn delete_profile(name: String) -> ActionResult {
    if name == "default" {
        return ActionResult {
            success: false,
            error: Some("Cannot delete the default profile".to_string()),
        };
    }
    let mut cmd = Command::new(hermes_python());
    cmd.arg(hermes_script())
        .args(["profile", "delete", &name, "--yes"])
        .current_dir(hermes_repo())
        .env("PATH", enhanced_path())
        .env("HERMES_HOME", hermes_home())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command_result(cmd)
}

#[tauri::command]
fn set_active_profile(name: String) -> Result<bool, String> {
    let mut cmd = Command::new(hermes_python());
    cmd.arg(hermes_script())
        .args(["profile", "use", &name])
        .current_dir(hermes_repo())
        .env("PATH", enhanced_path())
        .env("HERMES_HOME", hermes_home())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(command_result(cmd).success)
}

const ENTRY_DELIMITER: &str = "\n§\n";
const MEMORY_CHAR_LIMIT: usize = 2200;
const USER_CHAR_LIMIT: usize = 1375;

fn memory_entries(content: &str) -> Vec<Value> {
    content
        .split(ENTRY_DELIMITER)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .enumerate()
        .map(|(index, content)| serde_json::json!({ "index": index, "content": content }))
        .collect()
}

fn serialize_memory_entries(entries: &[String]) -> String {
    entries.join(ENTRY_DELIMITER)
}

#[tauri::command]
fn read_memory(profile: Option<String>) -> Value {
    let profile_ref = profile.as_deref();
    let mem_path = profile_home(profile_ref).join("MEMORY.md");
    let user_path = profile_home(profile_ref).join("USER.md");
    let mem = file_info(mem_path);
    let user = file_info(user_path);
    let memory_content = mem.get("content").and_then(Value::as_str).unwrap_or("");
    let user_content = user.get("content").and_then(Value::as_str).unwrap_or("");
    let (total_sessions, total_messages) = session_stats(profile_ref);
    serde_json::json!({
        "memory": {
            "content": memory_content,
            "exists": mem.get("exists").and_then(Value::as_bool).unwrap_or(false),
            "lastModified": mem.get("lastModified").cloned().unwrap_or(Value::Null),
            "entries": memory_entries(memory_content),
            "charCount": memory_content.len(),
            "charLimit": MEMORY_CHAR_LIMIT,
        },
        "user": {
            "content": user_content,
            "exists": user.get("exists").and_then(Value::as_bool).unwrap_or(false),
            "lastModified": user.get("lastModified").cloned().unwrap_or(Value::Null),
            "charCount": user_content.len(),
            "charLimit": USER_CHAR_LIMIT,
        },
        "stats": {
            "totalSessions": total_sessions,
            "totalMessages": total_messages,
        }
    })
}

#[tauri::command]
fn add_memory_entry(content: String, profile: Option<String>) -> ActionResult {
    let path = profile_home(profile.as_deref()).join("MEMORY.md");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut entries = existing
        .split(ENTRY_DELIMITER)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    entries.push(content.trim().to_string());
    let next = serialize_memory_entries(&entries);
    if next.len() > MEMORY_CHAR_LIMIT {
        return ActionResult {
            success: false,
            error: Some(format!(
                "Would exceed memory limit ({}/{MEMORY_CHAR_LIMIT} chars)",
                next.len()
            )),
        };
    }
    ActionResult {
        success: safe_write(path, next).is_ok(),
        error: None,
    }
}

#[tauri::command]
fn update_memory_entry(index: usize, content: String, profile: Option<String>) -> ActionResult {
    let path = profile_home(profile.as_deref()).join("MEMORY.md");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut entries = existing
        .split(ENTRY_DELIMITER)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if index >= entries.len() {
        return ActionResult {
            success: false,
            error: Some("Entry not found".to_string()),
        };
    }
    entries[index] = content.trim().to_string();
    let next = serialize_memory_entries(&entries);
    if next.len() > MEMORY_CHAR_LIMIT {
        return ActionResult {
            success: false,
            error: Some(format!(
                "Would exceed memory limit ({}/{MEMORY_CHAR_LIMIT} chars)",
                next.len()
            )),
        };
    }
    ActionResult {
        success: safe_write(path, next).is_ok(),
        error: None,
    }
}

#[tauri::command]
fn remove_memory_entry(index: usize, profile: Option<String>) -> Result<bool, String> {
    let path = profile_home(profile.as_deref()).join("MEMORY.md");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut entries = existing
        .split(ENTRY_DELIMITER)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if index >= entries.len() {
        return Ok(false);
    }
    entries.remove(index);
    safe_write(path, serialize_memory_entries(&entries))?;
    Ok(true)
}

#[tauri::command]
fn write_user_profile(content: String, profile: Option<String>) -> ActionResult {
    if content.len() > USER_CHAR_LIMIT {
        return ActionResult {
            success: false,
            error: Some(format!(
                "Exceeds limit ({}/{USER_CHAR_LIMIT} chars)",
                content.len()
            )),
        };
    }
    ActionResult {
        success: safe_write(profile_home(profile.as_deref()).join("USER.md"), content).is_ok(),
        error: None,
    }
}

const DEFAULT_SOUL: &str = "You are Hermes, a helpful AI assistant. You are friendly, knowledgeable, and always eager to help.\n\nYou communicate clearly and concisely. When asked to perform tasks, you think step-by-step and explain your reasoning. You are honest about your limitations and ask for clarification when needed.\n\nYou strive to be helpful while being safe and responsible. You respect the user's privacy and handle sensitive information carefully.\n";

#[tauri::command]
fn read_soul(profile: Option<String>) -> String {
    fs::read_to_string(profile_home(profile.as_deref()).join("SOUL.md")).unwrap_or_default()
}

#[tauri::command]
fn write_soul(content: String, profile: Option<String>) -> Result<bool, String> {
    safe_write(profile_home(profile.as_deref()).join("SOUL.md"), content)?;
    Ok(true)
}

#[tauri::command]
fn reset_soul(profile: Option<String>) -> Result<String, String> {
    write_soul(DEFAULT_SOUL.to_string(), profile)?;
    Ok(DEFAULT_SOUL.to_string())
}

#[tauri::command]
fn read_directory(dir_path: String) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        entries.push(DirectoryEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            is_directory: metadata.is_dir(),
            path: entry.path().to_string_lossy().to_string(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn copy_file_to_workspace(source_path: String) -> Result<Option<String>, String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Ok(None);
    }
    let workspace = hermes_home().join("workspace");
    fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
    let Some(name) = src.file_name() else {
        return Ok(None);
    };
    let dest = workspace.join(name);
    fs::copy(src, &dest).map_err(|error| error.to_string())?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[tauri::command]
fn select_project_directory() -> Option<String> {
    // Native dialogs are a later Tauri plugin step; default to HOME for now.
    home_dir().map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_logs(log_file: Option<String>, lines: Option<usize>) -> LogContent {
    let path = log_file
        .map(PathBuf::from)
        .unwrap_or_else(|| hermes_home().join("logs").join("hermes.log"));
    let content = fs::read_to_string(&path).unwrap_or_default();
    let limit = lines.unwrap_or(300);
    let selected = content
        .lines()
        .rev()
        .take(limit)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    LogContent {
        content: selected,
        path: path.to_string_lossy().to_string(),
    }
}

fn hermes_command(args: &[&str], timeout_note: &str) -> Result<String, String> {
    let output = Command::new(hermes_python())
        .arg(hermes_script())
        .args(args)
        .current_dir(hermes_repo())
        .env("PATH", enhanced_path())
        .env("HERMES_HOME", hermes_home())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("{timeout_note}: {error}"))?;
    if output.status.success() {
        Ok(strip_ansi(&String::from_utf8_lossy(&output.stdout)))
    } else {
        Err(strip_ansi(&String::from_utf8_lossy(&output.stderr)))
    }
}

#[tauri::command]
fn run_hermes_doctor() -> String {
    hermes_command(&["doctor"], "doctor failed").unwrap_or_else(|error| error)
}

#[tauri::command]
fn run_hermes_dump() -> String {
    hermes_command(&["dump"], "dump failed").unwrap_or_else(|error| error)
}

#[tauri::command]
fn run_hermes_update() -> ActionResult {
    match hermes_command(&["self", "update"], "update failed") {
        Ok(_) => ActionResult {
            success: true,
            error: None,
        },
        Err(error) => ActionResult {
            success: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
fn run_hermes_backup(_profile: Option<String>) -> Value {
    match hermes_command(&["backup"], "backup failed") {
        Ok(output) => serde_json::json!({ "success": true, "path": output.trim() }),
        Err(error) => serde_json::json!({ "success": false, "error": error }),
    }
}

#[tauri::command]
fn run_hermes_import(archive_path: String, _profile: Option<String>) -> ActionResult {
    match hermes_command(&["import", &archive_path], "import failed") {
        Ok(_) => ActionResult {
            success: true,
            error: None,
        },
        Err(error) => ActionResult {
            success: false,
            error: Some(error),
        },
    }
}

#[tauri::command]
fn start_install() -> ActionResult {
    ActionResult {
        success: false,
        error: Some("Installer has not been ported to Tauri yet. Use the Electron build or install Hermes manually.".to_string()),
    }
}

#[tauri::command]
fn check_open_claw() -> Value {
    let candidates = [
        home_dir().unwrap_or_default().join("OpenClaw"),
        home_dir().unwrap_or_default().join("openclaw"),
        home_dir().unwrap_or_default().join("Apps").join("OpenClaw"),
    ];
    let found = candidates.into_iter().find(|path| path.exists());
    serde_json::json!({
        "found": found.is_some(),
        "path": found.map(|path| path.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn run_claw_migrate() -> ActionResult {
    ActionResult {
        success: false,
        error: Some("OpenClaw migration has not been ported to Tauri yet.".to_string()),
    }
}

#[tauri::command]
fn check_for_updates() -> Option<String> {
    None
}

#[tauri::command]
fn download_update() -> bool {
    false
}

#[tauri::command]
fn install_update() {}

#[tauri::command]
fn list_cached_sessions(
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<SessionSummary>, String> {
    list_sessions(limit, offset)
}

#[tauri::command]
fn sync_session_cache() -> Result<Vec<SessionSummary>, String> {
    list_sessions(Some(50), Some(0))
}

#[tauri::command]
fn update_session_title(session_id: String, title: String) -> Result<(), String> {
    let db_path = state_db();
    if !db_path.exists() {
        return Ok(());
    }
    let db = Connection::open(db_path).map_err(|error| error.to_string())?;
    db.execute(
        "UPDATE sessions SET title = ?1 WHERE id = ?2",
        rusqlite::params![title, session_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn discover_memory_providers(_profile: Option<String>) -> Vec<Value> {
    Vec::new()
}

#[tauri::command]
fn list_mcp_servers(_profile: Option<String>) -> Vec<Value> {
    Vec::new()
}

#[tauri::command]
fn list_cron_jobs(_include_disabled: Option<bool>, _profile: Option<String>) -> Vec<Value> {
    Vec::new()
}

#[tauri::command]
fn create_cron_job(
    _schedule: String,
    _prompt: Option<String>,
    _name: Option<String>,
    _deliver: Option<String>,
    _profile: Option<String>,
) -> ActionResult {
    ActionResult {
        success: false,
        error: Some("Cron jobs have not been ported to Tauri yet.".to_string()),
    }
}

#[tauri::command]
fn remove_cron_job(_job_id: String, _profile: Option<String>) -> ActionResult {
    ActionResult {
        success: false,
        error: Some("Cron jobs have not been ported to Tauri yet.".to_string()),
    }
}

#[tauri::command]
fn pause_cron_job(_job_id: String, _profile: Option<String>) -> ActionResult {
    remove_cron_job(_job_id, _profile)
}

#[tauri::command]
fn resume_cron_job(_job_id: String, _profile: Option<String>) -> ActionResult {
    remove_cron_job(_job_id, _profile)
}

#[tauri::command]
fn trigger_cron_job(_job_id: String, _profile: Option<String>) -> ActionResult {
    remove_cron_job(_job_id, _profile)
}

#[tauri::command]
fn claw3d_status() -> Claw3dStatus {
    let office_dir = hermes_office_dir();
    let cloned = office_dir.join("package.json").exists();
    let installed = office_dir.join("node_modules").exists();
    let port = saved_claw3d_port();
    let dev_server_running = claw3d_dev_running();
    let adapter_running = claw3d_adapter_running();
    let dev_error = CLAW3D_DEV_ERROR
        .lock()
        .map(|error| error.clone())
        .unwrap_or_default();
    let adapter_error = CLAW3D_ADAPTER_ERROR
        .lock()
        .map(|error| error.clone())
        .unwrap_or_default();
    Claw3dStatus {
        cloned,
        installed,
        dev_server_running,
        adapter_running,
        port,
        port_in_use: !dev_server_running && claw3d_port_in_use(port),
        ws_url: saved_claw3d_ws_url(),
        running: dev_server_running && adapter_running,
        error: if dev_error.is_empty() {
            adapter_error
        } else {
            dev_error
        },
    }
}

#[tauri::command]
fn claw3d_setup(app: AppHandle) -> ActionResult {
    let office_dir = hermes_office_dir();
    let total_steps = 2;
    let mut log = String::new();
    let emit = |app: &AppHandle, step: i64, title: &str, detail: &str, log: &mut String| {
        log.push_str(detail);
        let _ = app.emit(
            "claw3d-setup-progress",
            serde_json::json!({
                "step": step,
                "totalSteps": total_steps,
                "title": title,
                "detail": detail.trim().chars().take(120).collect::<String>(),
                "log": log,
            }),
        );
    };

    if !office_dir.join("package.json").exists() {
        emit(
            &app,
            1,
            "Cloning Claw3D repository...",
            "Cloning from GitHub...\n",
            &mut log,
        );
        let output = Command::new("git")
            .args(["clone", HERMES_OFFICE_REPO, &office_dir.to_string_lossy()])
            .current_dir(home_dir().unwrap_or_else(|| PathBuf::from(".")))
            .env("PATH", enhanced_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();
        match output {
            Ok(output) if output.status.success() => {
                emit(
                    &app,
                    1,
                    "Cloning Claw3D repository...",
                    "Clone complete.\n",
                    &mut log,
                );
            }
            Ok(output) => {
                return ActionResult {
                    success: false,
                    error: Some(strip_ansi(&String::from_utf8_lossy(&output.stderr))),
                };
            }
            Err(error) => {
                return ActionResult {
                    success: false,
                    error: Some(format!("Failed to run git: {error}")),
                };
            }
        }
    } else {
        emit(
            &app,
            1,
            "Claw3D already cloned",
            "Repository already exists, pulling latest...\n",
            &mut log,
        );
        let _ = Command::new("git")
            .args(["pull", "--ff-only"])
            .current_dir(&office_dir)
            .env("PATH", enhanced_path())
            .output();
    }

    emit(
        &app,
        2,
        "Installing dependencies...",
        "Running npm install...\n",
        &mut log,
    );
    let output = Command::new(find_npm())
        .arg("install")
        .current_dir(&office_dir)
        .env("PATH", enhanced_path())
        .env(
            "HOME",
            home_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .to_string(),
        )
        .env("TERM", "dumb")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(output) if output.status.success() => {
            write_claw3d_settings(None);
            emit(
                &app,
                2,
                "Installing dependencies...",
                "Dependencies installed successfully.\n",
                &mut log,
            );
            ActionResult {
                success: true,
                error: None,
            }
        }
        Ok(output) => ActionResult {
            success: false,
            error: Some(strip_ansi(&String::from_utf8_lossy(&output.stderr))),
        },
        Err(error) => ActionResult {
            success: false,
            error: Some(format!("Failed to run npm: {error}")),
        },
    }
}

#[tauri::command]
fn claw3d_get_port() -> i64 {
    saved_claw3d_port()
}

#[tauri::command]
fn claw3d_set_port(port: i64) -> bool {
    if port <= 0 {
        return false;
    }
    if safe_write(claw3d_port_file(), port.to_string()).is_ok() {
        write_claw3d_settings(None);
        true
    } else {
        false
    }
}

#[tauri::command]
fn claw3d_get_ws_url() -> String {
    saved_claw3d_ws_url()
}

#[tauri::command]
fn claw3d_set_ws_url(url: String) -> bool {
    if url.trim().is_empty() {
        return false;
    }
    if safe_write(claw3d_ws_url_file(), url.trim().to_string()).is_ok() {
        write_claw3d_settings(Some(url.trim().to_string()));
        true
    } else {
        false
    }
}

#[tauri::command]
fn claw3d_start_all() -> ActionResult {
    if !hermes_office_dir().join("node_modules").exists() {
        return ActionResult {
            success: false,
            error: Some("Claw3D is not installed. Please install it first.".to_string()),
        };
    }
    if !claw3d_start_dev() {
        return ActionResult {
            success: false,
            error: Some(format!(
                "Failed to start dev server on port {}",
                saved_claw3d_port()
            )),
        };
    }
    if !claw3d_start_adapter() {
        return ActionResult {
            success: false,
            error: Some("Failed to start Hermes adapter".to_string()),
        };
    }
    ActionResult {
        success: true,
        error: None,
    }
}

#[tauri::command]
fn claw3d_stop_all() -> bool {
    let _ = claw3d_stop_dev();
    let _ = claw3d_stop_adapter();
    if let Ok(mut error) = CLAW3D_DEV_ERROR.lock() {
        error.clear();
    }
    if let Ok(mut error) = CLAW3D_ADAPTER_ERROR.lock() {
        error.clear();
    }
    true
}

#[tauri::command]
fn claw3d_get_logs() -> String {
    let dev_logs = CLAW3D_DEV_LOGS
        .lock()
        .map(|logs| logs.clone())
        .unwrap_or_default();
    let adapter_logs = CLAW3D_ADAPTER_LOGS
        .lock()
        .map(|logs| logs.clone())
        .unwrap_or_default();
    [
        (!dev_logs.is_empty()).then(|| format!("=== Dev Server ===\n{dev_logs}")),
        (!adapter_logs.is_empty()).then(|| format!("=== Adapter ===\n{adapter_logs}")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n")
}

#[tauri::command]
fn claw3d_start_dev() -> bool {
    write_claw3d_settings(None);
    start_claw3d_process(
        &["run", "dev"],
        &CLAW3D_DEV_PROCESS,
        &CLAW3D_DEV_LOGS,
        &CLAW3D_DEV_ERROR,
        claw3d_dev_pid_file(),
        &[("PORT", saved_claw3d_port().to_string())],
    )
}

#[tauri::command]
fn claw3d_stop_dev() -> bool {
    if let Ok(mut guard) = CLAW3D_DEV_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    stop_pid(claw3d_dev_pid_file());
    true
}

#[tauri::command]
fn claw3d_start_adapter() -> bool {
    start_claw3d_process(
        &["run", "hermes-adapter"],
        &CLAW3D_ADAPTER_PROCESS,
        &CLAW3D_ADAPTER_LOGS,
        &CLAW3D_ADAPTER_ERROR,
        claw3d_adapter_pid_file(),
        &[],
    )
}

#[tauri::command]
fn claw3d_stop_adapter() -> bool {
    if let Ok(mut guard) = CLAW3D_ADAPTER_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    stop_pid(claw3d_adapter_pid_file());
    true
}

#[tauri::command]
fn start_browser() {}

#[tauri::command]
fn stop_browser() {}

#[tauri::command]
fn navigate_browser(_url: String) {}

#[tauri::command]
fn get_browser_state() -> Option<Value> {
    None
}

#[tauri::command]
async fn get_hermes_health(profile: Option<String>) -> Value {
    let install = check_install();
    let connection = get_connection_config();
    let model = get_model_config(profile.clone());
    let env_values = env_map(profile.as_deref());
    let api_target = if connection.mode == "remote" && !connection.remote_url.is_empty() {
        connection.remote_url.clone()
    } else {
        LOCAL_API_URL.to_string()
    };
    let api_key = if connection.mode == "remote" {
        if connection.api_key.is_empty() {
            None
        } else {
            Some(connection.api_key.clone())
        }
    } else {
        env_values
            .get("API_SERVER_KEY")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2500))
        .build();
    let mut api_ok = false;
    let mut api_status = Value::Null;
    let mut api_error = String::new();
    if let Ok(client) = client {
        let mut req = client.get(format!("{}/health", api_target.trim_end_matches('/')));
        if let Some(key) = api_key {
            req = req.header(AUTHORIZATION, format!("Bearer {key}"));
        }
        match req.send().await {
            Ok(response) => {
                api_ok = response.status().is_success();
                api_status = Value::from(response.status().as_u16());
            }
            Err(error) => api_error = error.to_string(),
        }
    }

    serde_json::json!({
        "install": install,
        "connection": {
            "mode": connection.mode,
            "remoteUrl": connection.remote_url,
            "hasRemoteApiKey": !connection.api_key.is_empty(),
        },
        "gateway": {
            "running": gateway_running_internal(),
            "apiUrl": api_target,
            "apiOk": api_ok,
            "apiStatus": api_status,
            "apiError": api_error,
            "hasApiServerKey": env_values.get("API_SERVER_KEY").and_then(Value::as_str).is_some(),
        },
        "model": model,
        "env": {
            "hasMiniMaxKey": env_values.get("MINIMAX_API_KEY").and_then(Value::as_str).is_some(),
            "hasMiniMaxCnKey": env_values.get("MINIMAX_CN_API_KEY").and_then(Value::as_str).is_some(),
            "hasOpenAIKey": env_values.get("OPENAI_API_KEY").and_then(Value::as_str).is_some(),
            "hasXaiKey": env_values.get("XAI_API_KEY").and_then(Value::as_str).is_some(),
            "hasDashScopeKey": env_values.get("DASHSCOPE_API_KEY").and_then(Value::as_str).is_some(),
        },
        "credentialProviders": [],
    })
}

#[tauri::command]
async fn send_message(
    app: AppHandle,
    message: String,
    profile: Option<String>,
    resume_session_id: Option<String>,
    history: Option<Vec<ChatMessage>>,
    active_project: Option<String>,
) -> Result<ChatResponse, String> {
    let profile_ref = profile.as_deref();
    if !is_remote_mode() && !gateway_running_internal() {
        let _ = start_gateway(profile.clone()).await;
    }

    if is_remote_mode() || api_ready(profile_ref).await {
        match send_message_via_api(
            &app,
            &message,
            profile_ref,
            resume_session_id.clone(),
            history,
            active_project.clone(),
        )
        .await
        {
            Ok(response) => return Ok(response),
            Err(error) if is_remote_mode() => {
                emit_chat_error(&app, &error);
                return Err(error);
            }
            Err(_) => {
                // Local API failed; fall through to CLI.
            }
        }
    }

    match send_message_via_cli(
        &app,
        &message,
        profile_ref,
        resume_session_id,
        active_project,
    ) {
        Ok(response) => Ok(response),
        Err(error) => {
            emit_chat_error(&app, &error);
            Err(error)
        }
    }
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
            add_memory_entry,
            add_model,
            check_for_updates,
            check_install,
            check_open_claw,
            claw3d_get_logs,
            claw3d_get_port,
            claw3d_get_ws_url,
            claw3d_set_port,
            claw3d_set_ws_url,
            claw3d_setup,
            claw3d_start_adapter,
            claw3d_start_all,
            claw3d_start_dev,
            claw3d_status,
            claw3d_stop_adapter,
            claw3d_stop_all,
            claw3d_stop_dev,
            copy_file_to_workspace,
            create_cron_job,
            create_profile,
            delete_profile,
            discover_memory_providers,
            download_update,
            gateway_status,
            get_browser_state,
            get_config,
            get_credential_pool,
            get_env,
            get_app_version,
            get_connection_config,
            get_hermes_home,
            get_hermes_health,
            get_hermes_version,
            get_locale,
            get_model_config,
            get_platform_enabled,
            get_skill_content,
            get_session_messages,
            get_toolsets,
            is_remote_mode,
            install_skill,
            install_update,
            list_bundled_skills,
            list_cached_sessions,
            list_cron_jobs,
            list_installed_skills,
            list_mcp_servers,
            list_model_catalog,
            list_models,
            list_profiles,
            list_sessions,
            navigate_browser,
            open_external,
            open_local_path,
            pause_cron_job,
            read_directory,
            read_logs,
            read_memory,
            read_soul,
            remove_memory_entry,
            reveal_local_path,
            remove_model,
            remove_cron_job,
            reset_soul,
            resume_cron_job,
            run_claw_migrate,
            run_hermes_backup,
            run_hermes_doctor,
            run_hermes_dump,
            run_hermes_import,
            run_hermes_update,
            select_project_directory,
            send_message,
            set_active_profile,
            set_config,
            set_connection_config,
            set_credential_pool,
            set_env,
            set_locale,
            set_model_config,
            set_platform_enabled,
            set_toolset_enabled,
            start_browser,
            start_install,
            update_model,
            update_memory_entry,
            search_sessions,
            start_gateway,
            stop_browser,
            stop_gateway,
            sync_session_cache,
            test_remote_connection,
            trigger_cron_job,
            uninstall_skill,
            update_session_title,
            write_soul,
            write_user_profile,
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
