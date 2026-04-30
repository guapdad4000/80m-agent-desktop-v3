use once_cell::sync::Lazy;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use rusqlite::Connection;
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
            add_model,
            check_install,
            gateway_status,
            get_config,
            get_env,
            get_app_version,
            get_connection_config,
            get_hermes_home,
            get_hermes_health,
            get_hermes_version,
            get_locale,
            get_model_config,
            get_skill_content,
            get_session_messages,
            get_toolsets,
            is_remote_mode,
            install_skill,
            list_bundled_skills,
            list_installed_skills,
            list_model_catalog,
            list_models,
            list_sessions,
            open_external,
            open_local_path,
            reveal_local_path,
            remove_model,
            send_message,
            set_config,
            set_connection_config,
            set_env,
            set_locale,
            set_model_config,
            set_toolset_enabled,
            update_model,
            search_sessions,
            start_gateway,
            stop_gateway,
            test_remote_connection,
            uninstall_skill,
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
