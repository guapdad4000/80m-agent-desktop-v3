use once_cell::sync::Lazy;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

const LOCAL_API_URL: &str = "http://127.0.0.1:8642";
static GATEWAY_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

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

fn emit_chat_error(app: &AppHandle, error: &str) {
    let _ = app.emit("chat-error", error);
}

fn emit_chat_done(app: &AppHandle, session_id: Option<&str>) {
    let _ = app.emit("chat-done", session_id.unwrap_or(""));
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
            check_install,
            gateway_status,
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
            send_message,
            set_config,
            set_connection_config,
            set_env,
            set_locale,
            set_model_config,
            start_gateway,
            stop_gateway,
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
