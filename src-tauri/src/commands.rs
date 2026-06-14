use crate::config;
use crate::connection::{self, ConnectionRegistry};
use crate::credentials;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub registry: Arc<Mutex<ConnectionRegistry>>,
}

fn get_app_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}

#[tauri::command]
pub fn get_global_config(app: AppHandle) -> Result<config::GlobalConfig, String> {
    let app_dir = get_app_dir(&app);
    config::load_config(&app_dir)
}

#[tauri::command]
pub fn set_global_config(app: AppHandle, cfg: config::GlobalConfig) -> Result<(), String> {
    let app_dir = get_app_dir(&app);
    config::save_config(&app_dir, &cfg)
}

#[tauri::command]
pub fn get_sessions(app: AppHandle) -> Result<Vec<config::SessionProfile>, String> {
    let app_dir = get_app_dir(&app);
    config::load_sessions(&app_dir)
}

#[tauri::command]
pub fn save_session_profile(
    app: AppHandle,
    session: config::SessionProfile,
) -> Result<(), String> {
    let app_dir = get_app_dir(&app);
    config::save_session(&app_dir, &session)
}

#[tauri::command]
pub fn delete_session_profile(app: AppHandle, session_id: String) -> Result<(), String> {
    let app_dir = get_app_dir(&app);
    config::delete_session(&app_dir, &session_id)?;

    let mut folders = config::load_folders(&app_dir)?;
    for folder in &mut folders.folders {
        folder.sessions.retain(|s| s != &session_id);
    }
    folders.folders.retain(|f| !f.sessions.is_empty());
    config::save_folders(&app_dir, &folders)?;

    let _ = credentials::delete_password(&session_id);
    Ok(())
}

#[tauri::command]
pub fn get_folders(app: AppHandle) -> Result<config::FolderTree, String> {
    let app_dir = get_app_dir(&app);
    config::load_folders(&app_dir)
}

#[tauri::command]
pub fn set_folders(app: AppHandle, folders: config::FolderTree) -> Result<(), String> {
    let app_dir = get_app_dir(&app);
    config::save_folders(&app_dir, &folders)
}

#[tauri::command]
pub fn get_themes(app: AppHandle) -> Result<Vec<config::ThemeProfile>, String> {
    let app_dir = get_app_dir(&app);
    config::load_themes(&app_dir)
}

#[tauri::command]
pub fn save_theme_profile(app: AppHandle, theme: config::ThemeProfile) -> Result<(), String> {
    let app_dir = get_app_dir(&app);
    config::save_theme(&app_dir, &theme)
}

#[tauri::command]
pub fn save_session_password(session_id: String, password: String) -> Result<(), String> {
    credentials::save_password(&session_id, &password)
}

#[tauri::command]
pub fn delete_session_password(session_id: String) -> Result<(), String> {
    credentials::delete_password(&session_id)
}

#[tauri::command]
pub async fn connect_session(
    app: AppHandle,
    session: config::SessionProfile,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app_dir = get_app_dir(&app);

    connection::start_connection(
        app.clone(),
        session,
        app_dir,
        password,
        state.registry.clone(),
    )
}

#[tauri::command]
pub fn write_to_connection(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    connection::write_to_connection(&state.registry, &session_id, &data)
}

#[tauri::command]
pub fn resize_connection(
    _session_id: String,
    _cols: u32,
    _rows: u32,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn disconnect_session(
    app: AppHandle,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut registry = state.registry.lock().map_err(|e| e.to_string())?;
    registry.stop(&session_id);
    registry.remove(&session_id);
    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "closed", "message": "Disconnected" }),
    );
    Ok(())
}
