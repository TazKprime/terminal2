use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct CredentialStore {
    credentials: HashMap<String, String>,
}

fn credentials_path(app_dir: &Path) -> std::path::PathBuf {
    app_dir.join("credentials.json")
}

fn load_store(app_dir: &Path) -> Result<CredentialStore, String> {
    let path = credentials_path(app_dir);
    if !path.exists() {
        return Ok(CredentialStore {
            credentials: HashMap::new(),
        });
    }
    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read credentials: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse credentials: {}", e))
}

fn save_store(app_dir: &Path, store: &CredentialStore) -> Result<(), String> {
    let path = credentials_path(app_dir);
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write credentials: {}", e))
}

pub fn save_password(app_dir: &Path, session_id: &str, password: &str) -> Result<(), String> {
    let mut store = load_store(app_dir)?;
    store
        .credentials
        .insert(session_id.to_string(), password.to_string());
    save_store(app_dir, &store)
}

pub fn get_password(app_dir: &Path, session_id: &str) -> Result<String, String> {
    let store = load_store(app_dir)?;
    store
        .credentials
        .get(session_id)
        .cloned()
        .ok_or_else(|| format!("No password for session {}", session_id))
}

pub fn delete_password(app_dir: &Path, session_id: &str) -> Result<(), String> {
    let mut store = load_store(app_dir)?;
    store.credentials.remove(session_id);
    save_store(app_dir, &store)
}
