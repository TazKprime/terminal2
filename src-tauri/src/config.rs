use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    pub default_theme: String,
    pub default_font: FontConfig,
    pub last_session: Option<String>,
    pub recent_sessions: Vec<String>,
    pub quick_connect_defaults: QuickConnectDefaults,
    pub logging_defaults: LoggingDefaults,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontConfig {
    pub family: String,
    pub size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickConnectDefaults {
    pub protocol: String,
    pub terminal_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggingDefaults {
    pub enabled: bool,
    pub mode: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProfile {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub protocol: String,
    pub connection: ConnectionConfig,
    pub terminal: TerminalConfig,
    pub appearance: AppearanceConfig,
    pub logging: LoggingConfig,
    pub logon_automation: LogonAutomation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub private_key_path: String,
    pub password_saved: bool,
    pub tls_verify: bool,
    pub com_port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub flow_control: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalConfig {
    pub terminal_type: String,
    pub encoding: String,
    pub scrollback_lines: u32,
    pub wrap_lines: bool,
    pub local_echo: bool,
    pub newline_convention: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub line_spacing: f32,
    pub cursor_style: String,
    pub cursor_blink: bool,
    pub color_overrides: ColorOverrides,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorOverrides {
    pub background: Option<String>,
    pub foreground: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggingConfig {
    pub enabled: bool,
    pub mode: String,
    pub path: String,
    pub append: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogonAutomation {
    pub enabled: bool,
    pub send_initial_carriage_return: bool,
    pub steps: Vec<AutomationStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStep {
    pub expect: String,
    pub send: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderTree {
    pub folders: Vec<FolderEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub path: String,
    pub sessions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeProfile {
    pub name: String,
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection_background: String,
    pub ansi_colors: AnsiColors,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnsiColors {
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
}

pub fn ensure_directories(app_dir: &Path) -> Result<(), String> {
    let dirs = [
        app_dir.join("sessions"),
        app_dir.join("themes"),
        app_dir.join("logs"),
    ];
    for dir in &dirs {
        fs::create_dir_all(dir).map_err(|e| format!("Failed to create {:?}: {}", dir, e))?;
    }
    Ok(())
}

pub fn ensure_defaults(app_dir: &Path) -> Result<(), String> {
    let config_path = app_dir.join("config.json");
    if !config_path.exists() {
        let default_config = GlobalConfig {
            default_theme: "dark".to_string(),
            default_font: FontConfig {
                family: "Cascadia Mono".to_string(),
                size: 12,
            },
            last_session: None,
            recent_sessions: vec![],
            quick_connect_defaults: QuickConnectDefaults {
                protocol: "ssh2".to_string(),
                terminal_type: "xterm-256color".to_string(),
            },
            logging_defaults: LoggingDefaults {
                enabled: false,
                mode: "plaintext".to_string(),
                path: "logs/{session}_{date}_{time}.log".to_string(),
            },
        };
        let json = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;
    }

    let folders_path = app_dir.join("sessions").join("folders.json");
    if !folders_path.exists() {
        let default_folders = FolderTree { folders: vec![] };
        let json = serde_json::to_string_pretty(&default_folders)
            .map_err(|e| format!("Failed to serialize folders: {}", e))?;
        fs::write(&folders_path, json).map_err(|e| format!("Failed to write folders: {}", e))?;
    }

    let dark_theme_path = app_dir.join("themes").join("dark.json");
    if !dark_theme_path.exists() {
        let default_theme = ThemeProfile {
            name: "Dark".to_string(),
            background: "#1E1E1E".to_string(),
            foreground: "#D4D4D4".to_string(),
            cursor: "#FFFFFF".to_string(),
            selection_background: "#264F78".to_string(),
            ansi_colors: AnsiColors {
                black: "#000000".to_string(),
                red: "#CD3131".to_string(),
                green: "#0DBC79".to_string(),
                yellow: "#E5E510".to_string(),
                blue: "#2472C8".to_string(),
                magenta: "#BC3FBC".to_string(),
                cyan: "#11A8CD".to_string(),
                white: "#E5E5E5".to_string(),
                bright_black: "#666666".to_string(),
                bright_red: "#F14C4C".to_string(),
                bright_green: "#23D18B".to_string(),
                bright_yellow: "#F5F543".to_string(),
                bright_blue: "#3B8EEA".to_string(),
                bright_magenta: "#D670D6".to_string(),
                bright_cyan: "#29B8DB".to_string(),
                bright_white: "#E5E5E5".to_string(),
            },
        };
        let json = serde_json::to_string_pretty(&default_theme)
            .map_err(|e| format!("Failed to serialize theme: {}", e))?;
        fs::write(&dark_theme_path, json)
            .map_err(|e| format!("Failed to write dark theme: {}", e))?;
    }

    Ok(())
}

pub fn load_config(app_dir: &Path) -> Result<GlobalConfig, String> {
    let path = app_dir.join("config.json");
    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse config: {}", e))
}

pub fn save_config(app_dir: &Path, config: &GlobalConfig) -> Result<(), String> {
    let path = app_dir.join("config.json");
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write config: {}", e))
}

pub fn load_sessions(app_dir: &Path) -> Result<Vec<SessionProfile>, String> {
    let sessions_dir = app_dir.join("sessions");
    let mut sessions = Vec::new();
    let entries =
        fs::read_dir(&sessions_dir).map_err(|e| format!("Failed to read sessions: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            if path.file_name().and_then(|s| s.to_str()) == Some("folders.json") {
                continue;
            }
            let data =
                fs::read_to_string(&path).map_err(|e| format!("Failed to read session: {}", e))?;
            match serde_json::from_str::<SessionProfile>(&data) {
                Ok(profile) => sessions.push(profile),
                Err(_) => continue,
            }
        }
    }
    Ok(sessions)
}

pub fn save_session(app_dir: &Path, session: &SessionProfile) -> Result<(), String> {
    let path = app_dir
        .join("sessions")
        .join(format!("{}.json", session.id));
    let json = serde_json::to_string_pretty(session)
        .map_err(|e| format!("Failed to serialize session: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write session: {}", e))
}

pub fn delete_session(app_dir: &Path, session_id: &str) -> Result<(), String> {
    let path = app_dir
        .join("sessions")
        .join(format!("{}.json", session_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete session: {}", e))?;
    }
    Ok(())
}

pub fn load_folders(app_dir: &Path) -> Result<FolderTree, String> {
    let path = app_dir.join("sessions").join("folders.json");
    let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read folders: {}", e))?;
    serde_json::from_str(&data).map_err(|e| format!("Failed to parse folders: {}", e))
}

pub fn save_folders(app_dir: &Path, folders: &FolderTree) -> Result<(), String> {
    let path = app_dir.join("sessions").join("folders.json");
    let json = serde_json::to_string_pretty(folders)
        .map_err(|e| format!("Failed to serialize folders: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write folders: {}", e))
}

pub fn load_themes(app_dir: &Path) -> Result<Vec<ThemeProfile>, String> {
    let themes_dir = app_dir.join("themes");
    let mut themes = Vec::new();
    let entries =
        fs::read_dir(&themes_dir).map_err(|e| format!("Failed to read themes: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let data =
                fs::read_to_string(&path).map_err(|e| format!("Failed to read theme: {}", e))?;
            match serde_json::from_str::<ThemeProfile>(&data) {
                Ok(theme) => themes.push(theme),
                Err(_) => continue,
            }
        }
    }
    Ok(themes)
}

pub fn save_theme(app_dir: &Path, theme: &ThemeProfile) -> Result<(), String> {
    let filename = format!(
        "{}.json",
        theme.name.to_lowercase().replace(' ', "_")
    );
    let path = app_dir.join("themes").join(filename);
    let json = serde_json::to_string_pretty(theme)
        .map_err(|e| format!("Failed to serialize theme: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write theme: {}", e))
}
