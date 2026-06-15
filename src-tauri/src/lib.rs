mod commands;
mod config;
mod connection;
mod credentials;
mod logging;
mod scripting;
mod zmodem;

use connection::ConnectionRegistry;
use std::sync::{Arc, Mutex};
use tauri::Manager;

use crate::commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = Arc::new(Mutex::new(ConnectionRegistry::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState { registry })
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            config::ensure_directories(&app_dir)?;
            config::ensure_defaults(&app_dir)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_global_config,
            commands::set_global_config,
            commands::get_sessions,
            commands::save_session_profile,
            commands::delete_session_profile,
            commands::get_folders,
            commands::set_folders,
            commands::get_themes,
            commands::save_theme_profile,
            commands::save_session_password,
            commands::delete_session_password,
            commands::connect_session,
            commands::write_to_connection,
            commands::resize_connection,
            commands::disconnect_session,
            commands::save_file_dialog,
            commands::append_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
