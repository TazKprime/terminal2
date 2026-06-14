use keyring::Entry;

const SERVICE_NAME: &str = "com.myterminal.app";

pub fn save_password(session_id: &str, password: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, session_id).map_err(|e| format!("Failed to create entry: {}", e))?;
    entry
        .set_password(password)
        .map_err(|e| format!("Failed to save password: {}", e))?;
    Ok(())
}

pub fn get_password(session_id: &str) -> Result<String, String> {
    let entry =
        Entry::new(SERVICE_NAME, session_id).map_err(|e| format!("Failed to create entry: {}", e))?;
    entry
        .get_password()
        .map_err(|e| format!("Failed to get password: {}", e))
}

pub fn delete_password(session_id: &str) -> Result<(), String> {
    let entry =
        Entry::new(SERVICE_NAME, session_id).map_err(|e| format!("Failed to create entry: {}", e))?;
    entry
        .delete_credential()
        .map_err(|e| format!("Failed to delete password: {}", e))?;
    Ok(())
}
