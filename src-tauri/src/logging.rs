use chrono::Local;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

pub fn interpolate_log_path(template: &str, session_id: &str, session_name: &str) -> String {
    let now = Local::now();
    template
        .replace("{session}", session_id)
        .replace("{session_name}", session_name)
        .replace("{date}", &now.format("%Y%m%d").to_string())
        .replace("{time}", &now.format("%H%M%S").to_string())
}

pub fn strip_ansi_escapes(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        if data[i] == 0x1b {
            if i + 1 < data.len() && data[i + 1] == b'[' {
                i += 2;
                while i < data.len() && (data[i] >= 0x20 && data[i] <= 0x3f) {
                    i += 1;
                }
                if i < data.len() && data[i] >= 0x40 && data[i] <= 0x7e {
                    i += 1;
                }
            } else if i + 1 < data.len() && data[i + 1] == b']' {
                i += 2;
                while i < data.len() && data[i] != 0x07 {
                    if data[i] == 0x1b && i + 1 < data.len() && data[i + 1] == b'\\' {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
                if i < data.len() && data[i] == 0x07 {
                    i += 1;
                }
            } else {
                i += 1;
            }
        } else {
            result.push(data[i]);
            i += 1;
        }
    }
    result
}

pub fn write_log(
    app_dir: &Path,
    template: &str,
    session_id: &str,
    session_name: &str,
    mode: &str,
    append: bool,
    data: &[u8],
) -> Result<(), String> {
    let log_path = interpolate_log_path(template, session_id, session_name);
    let full_path = if Path::new(&log_path).is_relative() {
        app_dir.join(&log_path)
    } else {
        Path::new(&log_path).to_path_buf()
    };

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create log directory: {}", e))?;
    }

    let write_data = match mode {
        "plaintext" => strip_ansi_escapes(data),
        _ => data.to_vec(),
    };

    let mut file = if append {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&full_path)
            .map_err(|e| format!("Failed to open log file: {}", e))?
    } else {
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&full_path)
            .map_err(|e| format!("Failed to open log file: {}", e))?
    };

    file.write_all(&write_data)
        .map_err(|e| format!("Failed to write log: {}", e))?;
    Ok(())
}
