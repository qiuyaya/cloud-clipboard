// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppConfig {
    server_url: String,
    auto_clipboard: bool,
    sync_interval: u64,
    theme: String,
    language: String,
    enable_tray: bool,
    autostart: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: "http://localhost:3001".to_string(),
            auto_clipboard: true,
            sync_interval: 1000,
            theme: "light".to_string(),
            language: "zh".to_string(),
            enable_tray: true,
            autostart: false,
        }
    }
}

type ConfigState = Mutex<AppConfig>;

#[tauri::command]
async fn get_config(state: tauri::State<'_, ConfigState>) -> Result<AppConfig, String> {
    let config = state.lock().map_err(|e| format!("Failed to lock config: {}", e))?;
    Ok(config.clone())
}

#[tauri::command]
async fn set_config(
    config: AppConfig,
    state: tauri::State<'_, ConfigState>,
) -> Result<(), String> {
    let mut app_config = state.lock().map_err(|e| format!("Failed to lock config: {}", e))?;
    *app_config = config;
    Ok(())
}

#[tauri::command]
async fn get_clipboard_text() -> Result<String, String> {
    tauri_plugin_clipboard_manager::read_text()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_clipboard_text(text: String) -> Result<(), String> {
    tauri_plugin_clipboard_manager::write_text(text)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Mutex::new(AppConfig::default()))
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            get_clipboard_text,
            set_clipboard_text,
            show_notification
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}