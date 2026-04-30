use serde::Serialize;
use std::env;
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

fn env_has_any(keys: &[&str]) -> bool {
    keys.iter().any(|key| env::var_os(key).is_some())
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
fn get_hermes_home(_profile: Option<String>) -> String {
    hermes_home().to_string_lossy().to_string()
}

#[tauri::command]
fn get_connection_config() -> ConnectionConfig {
    ConnectionConfig {
        mode: "local".to_string(),
        remote_url: String::new(),
        api_key: String::new(),
    }
}

#[tauri::command]
fn is_remote_mode() -> bool {
    false
}

#[tauri::command]
fn test_remote_connection(url: String, _api_key: Option<String>) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

#[tauri::command]
fn get_model_config(_profile: Option<String>) -> ModelConfig {
    ModelConfig {
        provider: "openai".to_string(),
        model: "gpt-4.1-mini".to_string(),
        base_url: String::new(),
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
            set_locale,
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
