use crate::config::*;
use crate::credentials;
use crate::logging;
use crate::scripting::{self, ScriptExecutor};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct ConnectionRegistry {
    pub connections: HashMap<String, ConnectionHandle>,
}

pub struct ConnectionHandle {
    pub session_id: String,
    pub stop_flag: Arc<Mutex<bool>>,
    pub input_tx: mpsc::Sender<Vec<u8>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    pub fn insert(&mut self, session_id: String, handle: ConnectionHandle) {
        self.connections.insert(session_id, handle);
    }

    pub fn remove(&mut self, session_id: &str) -> Option<ConnectionHandle> {
        self.connections.remove(session_id)
    }

    pub fn stop(&mut self, session_id: &str) {
        if let Some(handle) = self.connections.get(session_id) {
            if let Ok(mut flag) = handle.stop_flag.lock() {
                *flag = true;
            }
            let _ = handle.input_tx.send(vec![]);
        }
    }

    pub fn send_input(&self, session_id: &str, data: Vec<u8>) -> Result<(), String> {
        eprintln!("[DEBUG] send_input session={} bytes={}", session_id, data.len());
        if let Some(handle) = self.connections.get(session_id) {
            handle
                .input_tx
                .send(data)
                .map_err(|e| format!("Failed to send input: {}", e))?;
            return Ok(());
        }
        eprintln!("[DEBUG] send_input: no connection found for session {}", session_id);
        Err(format!("No connection for session {}", session_id))
    }
}

pub fn start_connection(
    app: AppHandle,
    session: SessionProfile,
    app_dir: PathBuf,
    password: Option<String>,
    registry: Arc<Mutex<ConnectionRegistry>>,
) -> Result<(), String> {
    let session_id = session.id.clone();
    let protocol = session.protocol.clone();
    let conn_config = session.connection.clone();
    let term_config = session.terminal.clone();
    let logging_config = session.logging.clone();
    let automation = session.logon_automation.clone();
    let appearance = session.appearance.clone();

    let stop_flag = Arc::new(Mutex::new(false));
    let stop_flag_clone = stop_flag.clone();

    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();

    let handle = ConnectionHandle {
        session_id: session_id.clone(),
        stop_flag: stop_flag_clone.clone(),
        input_tx,
    };
    eprintln!("[DEBUG] start_connection: registering session={} protocol={}", session_id, protocol);
    registry
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id.clone(), handle);

    thread::spawn(move || {
        let _ = app.emit(
            &format!("status-{}", session_id),
            serde_json::json!({ "status": "connecting", "message": "Connecting..." }),
        );

        let result = match protocol.as_str() {
            "ssh2" => connect_ssh2(
                &app,
                &session_id,
                &conn_config,
                &term_config,
                &logging_config,
                &automation,
                &app_dir,
                password,
                stop_flag_clone,
                input_rx,
            ),
            "telnet" => connect_telnet(
                &app,
                &session_id,
                &conn_config,
                &logging_config,
                &automation,
                &app_dir,
                stop_flag_clone,
                input_rx,
            ),
            "telnet-ssl" => connect_telnet_ssl(
                &app,
                &session_id,
                &conn_config,
                &logging_config,
                &automation,
                &app_dir,
                stop_flag_clone,
                input_rx,
            ),
            "rlogin" => connect_rlogin(
                &app,
                &session_id,
                &conn_config,
                &logging_config,
                &automation,
                &app_dir,
                stop_flag_clone,
                input_rx,
            ),
            "simulation" => connect_simulation(
                &app,
                &session_id,
                &logging_config,
                &automation,
                &app_dir,
                stop_flag_clone,
                input_rx,
            ),
            _ => {
                let _ = app.emit(
                    &format!("status-{}", session_id),
                    serde_json::json!({ "status": "error", "message": format!("Unsupported protocol: {}", protocol) }),
                );
                return;
            }
        };

        if let Err(e) = result {
            let _ = app.emit(
                &format!("status-{}", session_id),
                serde_json::json!({ "status": "error", "message": e }),
            );
        }
    });

    Ok(())
}

fn drain_input(input_rx: &mpsc::Receiver<Vec<u8>>) -> Vec<u8> {
    let mut all = Vec::new();
    loop {
        match input_rx.try_recv() {
            Ok(data) => {
                if data.is_empty() {
                    return all;
                }
                eprintln!("[DEBUG] drain_input: got {} bytes", data.len());
                all.extend_from_slice(&data);
            }
            Err(_) => break,
        }
    }
    all
}

fn connect_ssh2(
    app: &AppHandle,
    session_id: &str,
    conn: &ConnectionConfig,
    term: &TerminalConfig,
    log_config: &LoggingConfig,
    automation: &LogonAutomation,
    app_dir: &std::path::Path,
    password: Option<String>,
    stop_flag: Arc<Mutex<bool>>,
    input_rx: mpsc::Receiver<Vec<u8>>,
) -> Result<(), String> {
    let addr = format!("{}:{}", conn.hostname, conn.port);
    let tcp = TcpStream::connect(&addr).map_err(|e| format!("Connection failed: {}", e))?;
    tcp.set_read_timeout(Some(std::time::Duration::from_millis(50)))
        .ok();

    let mut session = ssh2::Session::new().map_err(|e| format!("SSH session error: {}", e))?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    match conn.auth_method.as_str() {
        "password" => {
            let pw = password
                .or_else(|| {
                    if conn.password_saved {
                        credentials::get_password(session_id).ok()
                    } else {
                        None
                    }
                })
                .unwrap_or_default();
            session
                .userauth_password(&conn.username, &pw)
                .map_err(|e| format!("Password auth failed: {}", e))?;
        }
        "agent" => {
            session
                .userauth_agent(&conn.username)
                .map_err(|e| format!("Agent auth failed: {}", e))?;
        }
        "publickey" => {
            if !conn.private_key_path.is_empty() {
                session
                    .userauth_pubkey_file(
                        &conn.username,
                        None,
                        std::path::Path::new(&conn.private_key_path),
                        None,
                    )
                    .map_err(|e| format!("Public key auth failed: {}", e))?;
            } else {
                return Err("No private key path specified".to_string());
            }
        }
        _ => {
            return Err(format!("Unsupported auth method: {}", conn.auth_method));
        }
    }

    if !session.authenticated() {
        let _ = app.emit(
            &format!("status-{}", session_id),
            serde_json::json!({ "status": "auth-failed", "message": "Authentication failed" }),
        );
        return Ok(());
    }

    let mut channel = session
        .channel_session()
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    let pty_type = term.terminal_type.as_str();
    channel
        .request_pty(pty_type, None, Some((80, 24, 0, 0)))
        .map_err(|e| format!("PTY request failed: {}", e))?;
    channel
        .shell()
        .map_err(|e| format!("Shell request failed: {}", e))?;

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "connected", "message": "Connected" }),
    );

    let mut executor = if automation.enabled && !automation.steps.is_empty() {
        let steps: Vec<scripting::AutomationStep> = automation
            .steps
            .iter()
            .map(|s| scripting::AutomationStep {
                expect: s.expect.clone(),
                send: s.send.clone(),
            })
            .collect();
        Some(ScriptExecutor::new(
            steps,
            automation.send_initial_carriage_return,
            8192,
        ))
    } else {
        None
    };

    if let Some(ref mut exec) = executor {
        if exec.should_send_initial_cr() {
            channel.write_all(b"\r").ok();
            exec.mark_initial_cr_sent();
        }
    }

    let mut buf = [0u8; 8192];
    loop {
        if let Ok(flag) = stop_flag.lock() {
            if *flag {
                break;
            }
        }

        let input = drain_input(&input_rx);
        if !input.is_empty() {
            eprintln!("[DEBUG] SSH writing {} bytes to channel", input.len());
            if let Err(e) = channel.write_all(&input) {
                eprintln!("[DEBUG] SSH write error: {}", e);
                break;
            }
        }

        match channel.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = &buf[..n];

                if log_config.enabled {
                    let _ = logging::write_log(
                        app_dir,
                        &log_config.path,
                        session_id,
                        "ssh2",
                        &log_config.mode,
                        log_config.append,
                        data,
                    );
                }

                if let Some(ref mut exec) = executor {
                    if let Some(send_bytes) = exec.feed_input(data) {
                        channel.write_all(&send_bytes).ok();
                    }
                }

                let _ = app.emit(
                    &format!("data-{}", session_id),
                    serde_json::json!({ "data": data }),
                );
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            Err(_) => break,
        }
    }

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "closed", "message": "Connection closed" }),
    );

    let _ = channel.close();
    let _ = channel.wait_close();
    Ok(())
}

fn connect_telnet(
    app: &AppHandle,
    session_id: &str,
    conn: &ConnectionConfig,
    log_config: &LoggingConfig,
    automation: &LogonAutomation,
    app_dir: &std::path::Path,
    stop_flag: Arc<Mutex<bool>>,
    input_rx: mpsc::Receiver<Vec<u8>>,
) -> Result<(), String> {
    let addr = format!("{}:{}", conn.hostname, conn.port);
    let mut stream =
        TcpStream::connect(&addr).map_err(|e| format!("Telnet connection failed: {}", e))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_millis(50)))
        .ok();

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "connected", "message": "Connected via Telnet" }),
    );

    let _ = stream.write_all(&[
        0xff, 0xfd, 0x18, 0xff, 0xfd, 0x1f, 0xff, 0xfb, 0x18, 0xff, 0xfb, 0x1f,
    ]);

    let mut executor = if automation.enabled && !automation.steps.is_empty() {
        let steps: Vec<scripting::AutomationStep> = automation
            .steps
            .iter()
            .map(|s| scripting::AutomationStep {
                expect: s.expect.clone(),
                send: s.send.clone(),
            })
            .collect();
        Some(ScriptExecutor::new(
            steps,
            automation.send_initial_carriage_return,
            8192,
        ))
    } else {
        None
    };

    if let Some(ref mut exec) = executor {
        if exec.should_send_initial_cr() {
            stream.write_all(b"\r").ok();
            exec.mark_initial_cr_sent();
        }
    }

    let mut buf = [0u8; 8192];
    loop {
        if let Ok(flag) = stop_flag.lock() {
            if *flag {
                break;
            }
        }

        let input = drain_input(&input_rx);
        if !input.is_empty() {
            if stream.write_all(&input).is_err() {
                break;
            }
        }

        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = &buf[..n];
                let clean_data = handle_telnet_iac(data);

                if log_config.enabled {
                    let _ = logging::write_log(
                        app_dir,
                        &log_config.path,
                        session_id,
                        "telnet",
                        &log_config.mode,
                        log_config.append,
                        &clean_data,
                    );
                }

                if let Some(ref mut exec) = executor {
                    if let Some(send_bytes) = exec.feed_input(&clean_data) {
                        stream.write_all(&send_bytes).ok();
                    }
                }

                let _ = app.emit(
                    &format!("data-{}", session_id),
                    serde_json::json!({ "data": clean_data }),
                );
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            Err(_) => break,
        }
    }

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "closed", "message": "Telnet connection closed" }),
    );
    Ok(())
}

fn connect_telnet_ssl(
    app: &AppHandle,
    session_id: &str,
    conn: &ConnectionConfig,
    log_config: &LoggingConfig,
    automation: &LogonAutomation,
    app_dir: &std::path::Path,
    stop_flag: Arc<Mutex<bool>>,
    input_rx: mpsc::Receiver<Vec<u8>>,
) -> Result<(), String> {
    let addr = format!("{}:{}", conn.hostname, conn.port);
    let tcp = TcpStream::connect(&addr).map_err(|e| format!("TCP connection failed: {}", e))?;

    let connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(!conn.tls_verify)
        .build()
        .map_err(|e| format!("TLS connector error: {}", e))?;

    let domain = conn.hostname.as_str();
    let mut stream = connector
        .connect(domain, tcp)
        .map_err(|e| format!("TLS handshake failed: {}", e))?;
    stream
        .get_ref()
        .set_read_timeout(Some(std::time::Duration::from_millis(50)))
        .ok();

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "connected", "message": "Connected via Telnet/SSL" }),
    );

    let _ = stream.write_all(&[
        0xff, 0xfd, 0x18, 0xff, 0xfd, 0x1f, 0xff, 0xfb, 0x18, 0xff, 0xfb, 0x1f,
    ]);

    let mut executor = if automation.enabled && !automation.steps.is_empty() {
        let steps: Vec<scripting::AutomationStep> = automation
            .steps
            .iter()
            .map(|s| scripting::AutomationStep {
                expect: s.expect.clone(),
                send: s.send.clone(),
            })
            .collect();
        Some(ScriptExecutor::new(
            steps,
            automation.send_initial_carriage_return,
            8192,
        ))
    } else {
        None
    };

    if let Some(ref mut exec) = executor {
        if exec.should_send_initial_cr() {
            stream.write_all(b"\r").ok();
            exec.mark_initial_cr_sent();
        }
    }

    let mut buf = [0u8; 8192];
    loop {
        if let Ok(flag) = stop_flag.lock() {
            if *flag {
                break;
            }
        }

        let input = drain_input(&input_rx);
        if !input.is_empty() {
            if stream.write_all(&input).is_err() {
                break;
            }
        }

        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = &buf[..n];
                let clean_data = handle_telnet_iac(data);

                if log_config.enabled {
                    let _ = logging::write_log(
                        app_dir,
                        &log_config.path,
                        session_id,
                        "telnet-ssl",
                        &log_config.mode,
                        log_config.append,
                        &clean_data,
                    );
                }

                if let Some(ref mut exec) = executor {
                    if let Some(send_bytes) = exec.feed_input(&clean_data) {
                        stream.write_all(&send_bytes).ok();
                    }
                }

                let _ = app.emit(
                    &format!("data-{}", session_id),
                    serde_json::json!({ "data": clean_data }),
                );
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            Err(_) => break,
        }
    }

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "closed", "message": "Telnet/SSL connection closed" }),
    );
    Ok(())
}

fn connect_rlogin(
    app: &AppHandle,
    session_id: &str,
    conn: &ConnectionConfig,
    log_config: &LoggingConfig,
    automation: &LogonAutomation,
    app_dir: &std::path::Path,
    stop_flag: Arc<Mutex<bool>>,
    input_rx: mpsc::Receiver<Vec<u8>>,
) -> Result<(), String> {
    let addr = format!("{}:{}", conn.hostname, conn.port);
    let mut stream =
        TcpStream::connect(&addr).map_err(|e| format!("RLogin connection failed: {}", e))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_millis(50)))
        .ok();

    let mut handshake = Vec::new();
    handshake.push(0x00);
    let user = conn.username.as_bytes();
    let term_type = b"xterm\0";
    handshake.push(0x00);
    handshake.extend_from_slice(user);
    handshake.push(0x00);
    handshake.extend_from_slice(term_type);
    handshake.push(0x00);

    stream
        .write_all(&handshake)
        .map_err(|e| format!("RLogin handshake write failed: {}", e))?;

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "connected", "message": "Connected via RLogin" }),
    );

    let mut executor = if automation.enabled && !automation.steps.is_empty() {
        let steps: Vec<scripting::AutomationStep> = automation
            .steps
            .iter()
            .map(|s| scripting::AutomationStep {
                expect: s.expect.clone(),
                send: s.send.clone(),
            })
            .collect();
        Some(ScriptExecutor::new(
            steps,
            automation.send_initial_carriage_return,
            8192,
        ))
    } else {
        None
    };

    if let Some(ref mut exec) = executor {
        if exec.should_send_initial_cr() {
            stream.write_all(b"\r").ok();
            exec.mark_initial_cr_sent();
        }
    }

    let mut buf = [0u8; 8192];
    loop {
        if let Ok(flag) = stop_flag.lock() {
            if *flag {
                break;
            }
        }

        let input = drain_input(&input_rx);
        if !input.is_empty() {
            if stream.write_all(&input).is_err() {
                break;
            }
        }

        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = &buf[..n];

                if log_config.enabled {
                    let _ = logging::write_log(
                        app_dir,
                        &log_config.path,
                        session_id,
                        "rlogin",
                        &log_config.mode,
                        log_config.append,
                        data,
                    );
                }

                if let Some(ref mut exec) = executor {
                    if let Some(send_bytes) = exec.feed_input(data) {
                        stream.write_all(&send_bytes).ok();
                    }
                }

                let _ = app.emit(
                    &format!("data-{}", session_id),
                    serde_json::json!({ "data": data }),
                );
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(10));
                continue;
            }
            Err(_) => break,
        }
    }

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "closed", "message": "RLogin connection closed" }),
    );
    Ok(())
}

fn connect_simulation(
    app: &AppHandle,
    session_id: &str,
    log_config: &LoggingConfig,
    automation: &LogonAutomation,
    app_dir: &std::path::Path,
    stop_flag: Arc<Mutex<bool>>,
    input_rx: mpsc::Receiver<Vec<u8>>,
) -> Result<(), String> {
    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "connected", "message": "Simulation mode" }),
    );

    let welcome = b"\r\nMyTerminal Simulation Mode\r\nType 'help' for available commands.\r\n\r\nsimulation> ".to_vec();
    let _ = app.emit(
        &format!("data-{}", session_id),
        serde_json::json!({ "data": welcome }),
    );

    let mut executor = if automation.enabled && !automation.steps.is_empty() {
        let steps: Vec<scripting::AutomationStep> = automation
            .steps
            .iter()
            .map(|s| scripting::AutomationStep {
                expect: s.expect.clone(),
                send: s.send.clone(),
            })
            .collect();
        Some(ScriptExecutor::new(
            steps,
            automation.send_initial_carriage_return,
            8192,
        ))
    } else {
        None
    };

    if let Some(ref mut exec) = executor {
        if exec.should_send_initial_cr() {
            let response = process_simulation_command(b"");
            if log_config.enabled {
                let _ = logging::write_log(
                    app_dir,
                    &log_config.path,
                    session_id,
                    "simulation",
                    &log_config.mode,
                    log_config.append,
                    &response,
                );
            }
            let _ = app.emit(
                &format!("data-{}", session_id),
                serde_json::json!({ "data": response }),
            );
            exec.mark_initial_cr_sent();
        }
    }

    let mut input_buffer = Vec::new();

    loop {
        if let Ok(flag) = stop_flag.lock() {
            if *flag {
                break;
            }
        }

        match input_rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(data) => {
                if data.is_empty() {
                    break;
                }
                for &byte in &data {
                    if byte == b'\r' || byte == b'\n' {
                        let cmd = input_buffer.clone();
                        input_buffer.clear();

                        let response = process_simulation_command(&cmd);

                        if log_config.enabled {
                            let _ = logging::write_log(
                                app_dir,
                                &log_config.path,
                                session_id,
                                "simulation",
                                &log_config.mode,
                                log_config.append,
                                &response,
                            );
                        }

                        if let Some(ref mut exec) = executor {
                            if let Some(send_bytes) = exec.feed_input(&response) {
                                let _ = app.emit(
                                    &format!("data-{}", session_id),
                                    serde_json::json!({ "data": send_bytes }),
                                );
                            }
                        }

                        let _ = app.emit(
                            &format!("data-{}", session_id),
                            serde_json::json!({ "data": response }),
                        );
                    } else if byte == 0x7f || byte == 0x08 {
                        input_buffer.pop();
                        let _ = app.emit(
                            &format!("data-{}", session_id),
                            serde_json::json!({ "data": vec![0x08, b' ', 0x08] }),
                        );
                    } else {
                        input_buffer.push(byte);
                        let _ = app.emit(
                            &format!("data-{}", session_id),
                            serde_json::json!({ "data": vec![byte] }),
                        );
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                break;
            }
        }
    }

    let _ = app.emit(
        &format!("status-{}", session_id),
        serde_json::json!({ "status": "closed", "message": "Simulation ended" }),
    );
    Ok(())
}

fn process_simulation_command(cmd: &[u8]) -> Vec<u8> {
    let cmd_str = String::from_utf8_lossy(cmd).trim().to_string();
    let lower = cmd_str.to_lowercase();

    let response = match lower.as_str() {
        "" => "\r\nsimulation> ".to_string(),
        "help" => "\r\nAvailable commands:\r\n  help     - Show this help\r\n  ls/dir   - List files\r\n  date     - Show current date/time\r\n  whoami   - Show current user\r\n  exit     - End simulation\r\n\r\nsimulation> ".to_string(),
        "ls" | "dir" => "\r\n  Volume in drive C has no label.\r\n  Directory of C:\\simulation\r\n\r\n  06/14/2026  10:30 AM    <DIR>          .\r\n  06/14/2026  10:30 AM    <DIR>          ..\r\n  06/14/2026  10:30 AM               128 readme.txt\r\n  06/14/2026  10:30 AM             1,024 data.csv\r\n               2 File(s)          1,152 bytes\r\n               2 Dir(s)   50,000,000,000 bytes free\r\n\r\nsimulation> ".to_string(),
        "date" => {
            let now = chrono::Local::now();
            format!(
                "\r\nThe current date is: {}\r\n\r\nsimulation> ",
                now.format("%a %m/%d/%Y")
            )
        }
        "whoami" => "\r\nsimulation-user\r\n\r\nsimulation> ".to_string(),
        "exit" | "quit" => "\r\nGoodbye.\r\n".to_string(),
        _ => format!(
            "\r\n'{}' is not recognized as an internal or external command.\r\n\r\nsimulation> ",
            cmd_str
        ),
    };

    response.into_bytes()
}

fn handle_telnet_iac(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut i = 0;

    while i < data.len() {
        if data[i] == 0xff {
            if i + 1 < data.len() {
                match data[i + 1] {
                    0xfd | 0xfb | 0xfa => {
                        if i + 2 < data.len() {
                            let option = data[i + 2];
                            if data[i + 1] == 0xfd {
                                result.extend_from_slice(&[0xff, 0xfc, option]);
                            }
                            i += 3;
                            if data[i - 1] == 0xfa {
                                while i < data.len() && data[i] != 0xf0 {
                                    i += 1;
                                }
                                i += 1;
                            }
                        } else {
                            i += 2;
                        }
                    }
                    0xfc | 0xfe => i += 2,
                    _ => i += 2,
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

pub fn write_to_connection(
    registry: &Arc<Mutex<ConnectionRegistry>>,
    session_id: &str,
    data: &[u8],
) -> Result<(), String> {
    let reg = registry.lock().map_err(|e| e.to_string())?;
    reg.send_input(session_id, data.to_vec())
}
