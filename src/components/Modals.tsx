import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  GlobalConfig,
  SessionProfile,
  ThemeProfile,
  AutomationStep,
  DEFAULT_SESSION,
  PROTOCOLS,
} from "../types";

function QuickConnect({
  config,
  onConnect,
  onClose,
}: {
  config: GlobalConfig | null;
  onConnect: (session: SessionProfile, password?: string) => void;
  onClose: () => void;
}) {
  const [protocol, setProtocol] = useState(
    config?.quickConnectDefaults.protocol || "ssh2"
  );
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const defaultPorts: Record<string, string> = {
      ssh2: "22",
      telnet: "23",
      "telnet-ssl": "992",
      rlogin: "513",
      serial: "0",
      simulation: "0",
    };
    setPort(defaultPorts[protocol] || "22");
  }, [protocol]);

  const handleConnect = () => {
    const session: SessionProfile = {
      ...DEFAULT_SESSION,
      name: `${hostname || "Simulation"}`,
      protocol,
      connection: {
        ...DEFAULT_SESSION.connection,
        hostname,
        port: parseInt(port) || 22,
        username,
      },
    };
    onConnect(session, password || undefined);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Quick Connect</h2>
          <button className="modal-close" onClick={onClose}>
            x
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Protocol</label>
            <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {protocol !== "simulation" && (
            <>
              <div className="form-row">
                <div className="form-group" style={{ flex: 3 }}>
                  <label>Host / IP Address</label>
                  <input
                    type="text"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    placeholder="192.168.1.100"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Port</label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>

              {protocol !== "rlogin" && (
                <div className="form-group">
                  <label>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleConnect}>
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileEditor({
  session,
  onSave,
  onClose,
}: {
  session: SessionProfile | null;
  onSave: (session: SessionProfile) => void;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<SessionProfile>(
    session || { ...DEFAULT_SESSION, id: "" }
  );
  const [activeSection, setActiveSection] = useState<
    "connection" | "terminal" | "appearance" | "logging" | "automation"
  >("connection");
  const [password, setPassword] = useState("");

  const updateProfile = (path: string, value: any) => {
    setProfile((prev) => {
      const newProfile = { ...prev };
      const keys = path.split(".");
      let obj: any = newProfile;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return newProfile;
    });
  };

  const addAutomationStep = () => {
    setProfile((prev) => ({
      ...prev,
      logonAutomation: {
        ...prev.logonAutomation,
        steps: [...prev.logonAutomation.steps, { expect: "", send: "" }],
      },
    }));
  };

  const updateAutomationStep = (
    index: number,
    field: "expect" | "send",
    value: string
  ) => {
    setProfile((prev) => {
      const steps = [...prev.logonAutomation.steps];
      steps[index] = { ...steps[index], [field]: value };
      return {
        ...prev,
        logonAutomation: { ...prev.logonAutomation, steps },
      };
    });
  };

  const removeAutomationStep = (index: number) => {
    setProfile((prev) => ({
      ...prev,
      logonAutomation: {
        ...prev.logonAutomation,
        steps: prev.logonAutomation.steps.filter((_, i) => i !== index),
      },
    }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{session ? "Edit Profile" : "New Profile"}</h2>
          <button className="modal-close" onClick={onClose}>
            x
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Session Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => updateProfile("name", e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Folder</label>
            <input
              type="text"
              value={profile.folder}
              onChange={(e) => updateProfile("folder", e.target.value)}
              placeholder="Production/Web"
            />
          </div>

          <div className="form-group">
            <label>Protocol</label>
            <select
              value={profile.protocol}
              onChange={(e) => updateProfile("protocol", e.target.value)}
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="section-tabs">
            {(
              ["connection", "terminal", "appearance", "logging", "automation"] as const
            ).map((section) => (
              <div
                key={section}
                className={`section-tab ${activeSection === section ? "active" : ""}`}
                onClick={() => setActiveSection(section)}
              >
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </div>
            ))}
          </div>

          {activeSection === "connection" && (
            <>
              <div className="form-row">
                <div className="form-group" style={{ flex: 3 }}>
                  <label>Hostname</label>
                  <input
                    type="text"
                    value={profile.connection.hostname}
                    onChange={(e) =>
                      updateProfile("connection.hostname", e.target.value)
                    }
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Port</label>
                  <input
                    type="number"
                    value={profile.connection.port}
                    onChange={(e) =>
                      updateProfile(
                        "connection.port",
                        parseInt(e.target.value) || 0
                      )
                    }
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={profile.connection.username}
                  onChange={(e) =>
                    updateProfile("connection.username", e.target.value)
                  }
                />
              </div>

              <div className="form-group">
                <label>Auth Method</label>
                <select
                  value={profile.connection.authMethod}
                  onChange={(e) =>
                    updateProfile("connection.authMethod", e.target.value)
                  }
                >
                  <option value="password">Password</option>
                  <option value="publickey">Public Key</option>
                  <option value="agent">SSH Agent</option>
                </select>
              </div>

              {profile.connection.authMethod === "password" && (
                <>
                  <div className="form-group">
                    <label>Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <div className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={profile.connection.passwordSaved}
                      onChange={(e) =>
                        updateProfile(
                          "connection.passwordSaved",
                          e.target.checked
                        )
                      }
                    />
                    <span>Save password in credential store</span>
                  </div>
                </>
              )}

              {profile.connection.authMethod === "publickey" && (
                <div className="form-group">
                  <label>Private Key Path</label>
                  <input
                    type="text"
                    value={profile.connection.privateKeyPath}
                    onChange={(e) =>
                      updateProfile("connection.privateKeyPath", e.target.value)
                    }
                  />
                </div>
              )}

              {profile.protocol === "telnet-ssl" && (
                <div className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={profile.connection.tlsVerify}
                    onChange={(e) =>
                      updateProfile("connection.tlsVerify", e.target.checked)
                    }
                  />
                  <span>Verify TLS certificate</span>
                </div>
              )}

              {profile.protocol === "serial" && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>COM Port</label>
                      <input
                        type="text"
                        value={profile.connection.comPort}
                        onChange={(e) =>
                          updateProfile("connection.comPort", e.target.value)
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label>Baud Rate</label>
                      <input
                        type="number"
                        value={profile.connection.baudRate}
                        onChange={(e) =>
                          updateProfile(
                            "connection.baudRate",
                            parseInt(e.target.value) || 9600
                          )
                        }
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Data Bits</label>
                      <select
                        value={profile.connection.dataBits}
                        onChange={(e) =>
                          updateProfile(
                            "connection.dataBits",
                            parseInt(e.target.value)
                          )
                        }
                      >
                        <option value={7}>7</option>
                        <option value={8}>8</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Parity</label>
                      <select
                        value={profile.connection.parity}
                        onChange={(e) =>
                          updateProfile("connection.parity", e.target.value)
                        }
                      >
                        <option value="none">None</option>
                        <option value="odd">Odd</option>
                        <option value="even">Even</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Stop Bits</label>
                      <select
                        value={profile.connection.stopBits}
                        onChange={(e) =>
                          updateProfile(
                            "connection.stopBits",
                            parseInt(e.target.value)
                          )
                        }
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {activeSection === "terminal" && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Terminal Type</label>
                  <select
                    value={profile.terminal.terminalType}
                    onChange={(e) =>
                      updateProfile("terminal.terminalType", e.target.value)
                    }
                  >
                    <option value="xterm-256color">xterm-256color</option>
                    <option value="xterm">xterm</option>
                    <option value="vt100">vt100</option>
                    <option value="vt220">vt220</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Encoding</label>
                  <select
                    value={profile.terminal.encoding}
                    onChange={(e) =>
                      updateProfile("terminal.encoding", e.target.value)
                    }
                  >
                    <option value="utf-8">UTF-8</option>
                    <option value="ascii">ASCII</option>
                    <option value="latin1">Latin-1</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Scrollback Lines</label>
                <input
                  type="number"
                  value={profile.terminal.scrollbackLines}
                  onChange={(e) =>
                    updateProfile(
                      "terminal.scrollbackLines",
                      parseInt(e.target.value) || 5000
                    )
                  }
                />
              </div>

              <div className="form-checkbox">
                <input
                  type="checkbox"
                  checked={profile.terminal.wrapLines}
                  onChange={(e) =>
                    updateProfile("terminal.wrapLines", e.target.checked)
                  }
                />
                <span>Wrap lines</span>
              </div>

              <div className="form-checkbox">
                <input
                  type="checkbox"
                  checked={profile.terminal.localEcho}
                  onChange={(e) =>
                    updateProfile("terminal.localEcho", e.target.checked)
                  }
                />
                <span>Local echo</span>
              </div>
            </>
          )}

          {activeSection === "appearance" && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Theme</label>
                  <input
                    type="text"
                    value={profile.appearance.theme}
                    onChange={(e) =>
                      updateProfile("appearance.theme", e.target.value)
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Font Family</label>
                  <input
                    type="text"
                    value={profile.appearance.fontFamily}
                    onChange={(e) =>
                      updateProfile("appearance.fontFamily", e.target.value)
                    }
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Font Size</label>
                  <input
                    type="number"
                    value={profile.appearance.fontSize}
                    onChange={(e) =>
                      updateProfile(
                        "appearance.fontSize",
                        parseInt(e.target.value) || 12
                      )
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Line Spacing</label>
                  <input
                    type="number"
                    step="0.1"
                    value={profile.appearance.lineSpacing}
                    onChange={(e) =>
                      updateProfile(
                        "appearance.lineSpacing",
                        parseFloat(e.target.value) || 1.1
                      )
                    }
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Cursor Style</label>
                  <select
                    value={profile.appearance.cursorStyle}
                    onChange={(e) =>
                      updateProfile("appearance.cursorStyle", e.target.value)
                    }
                  >
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                    <option value="bar">Bar</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>&nbsp;</label>
                  <div className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={profile.appearance.cursorBlink}
                      onChange={(e) =>
                        updateProfile("appearance.cursorBlink", e.target.checked)
                      }
                    />
                    <span>Cursor blink</span>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Background Override</label>
                  <input
                    type="color"
                    value={profile.appearance.colorOverrides.background || "#1E1E1E"}
                    onChange={(e) =>
                      updateProfile("appearance.colorOverrides.background", e.target.value)
                    }
                    style={{ width: "100%", height: 32 }}
                  />
                </div>
                <div className="form-group">
                  <label>Foreground Override</label>
                  <input
                    type="color"
                    value={profile.appearance.colorOverrides.foreground || "#D4D4D4"}
                    onChange={(e) =>
                      updateProfile("appearance.colorOverrides.foreground", e.target.value)
                    }
                    style={{ width: "100%", height: 32 }}
                  />
                </div>
              </div>
            </>
          )}

          {activeSection === "logging" && (
            <>
              <div className="form-checkbox">
                <input
                  type="checkbox"
                  checked={profile.logging.enabled}
                  onChange={(e) =>
                    updateProfile("logging.enabled", e.target.checked)
                  }
                />
                <span>Enable logging</span>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Mode</label>
                  <select
                    value={profile.logging.mode}
                    onChange={(e) =>
                      updateProfile("logging.mode", e.target.value)
                    }
                  >
                    <option value="plaintext">Plaintext</option>
                    <option value="raw">Raw</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Append</label>
                  <div className="form-checkbox" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={profile.logging.append}
                      onChange={(e) =>
                        updateProfile("logging.append", e.target.checked)
                      }
                    />
                    <span>Append to existing log</span>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Log Path</label>
                <input
                  type="text"
                  value={profile.logging.path}
                  onChange={(e) =>
                    updateProfile("logging.path", e.target.value)
                  }
                />
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 4,
                  }}
                >
                  Variables: {"{session}"}, {"{session_name}"}, {"{date}"}, {"{time}"}
                </div>
              </div>
            </>
          )}

          {activeSection === "automation" && (
            <>
              <div className="form-checkbox">
                <input
                  type="checkbox"
                  checked={profile.logonAutomation.enabled}
                  onChange={(e) =>
                    updateProfile("logonAutomation.enabled", e.target.checked)
                  }
                />
                <span>Enable logon automation</span>
              </div>

              {profile.logonAutomation.enabled && (
                <>
                  <div className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={profile.logonAutomation.sendInitialCarriageReturn}
                      onChange={(e) =>
                        updateProfile(
                          "logonAutomation.sendInitialCarriageReturn",
                          e.target.checked
                        )
                      }
                    />
                    <span>Send initial carriage return</span>
                  </div>

                  <div className="automation-steps">
                    {profile.logonAutomation.steps.map((step, index) => (
                      <div key={index} className="automation-step">
                        <input
                          type="text"
                          placeholder="Expect..."
                          value={step.expect}
                          onChange={(e) =>
                            updateAutomationStep(index, "expect", e.target.value)
                          }
                        />
                        <input
                          type="text"
                          placeholder="Send..."
                          value={step.send}
                          onChange={(e) =>
                            updateAutomationStep(index, "send", e.target.value)
                          }
                        />
                        <button
                          className="icon-btn"
                          onClick={() => removeAutomationStep(index)}
                          style={{ flexShrink: 0 }}
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    className="btn btn-sm"
                    onClick={addAutomationStep}
                    style={{ marginTop: 8 }}
                  >
                    + Add Step
                  </button>

                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 8,
                    }}
                  >
                    Send tokens: {"\\r"}, {"\\n"}, {"\\t"}, {"\\xNN"}, {"{ENTER}"}, {"{TAB}"}, {"{F1}"}-{"{F12}"}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const sessionToSave = { ...profile };
              if (
                profile.connection.authMethod === "password" &&
                profile.connection.passwordSaved &&
                password &&
                sessionToSave.id
              ) {
                try {
                  await invoke("save_session_password", {
                    sessionId: sessionToSave.id,
                    password,
                  });
                } catch (e) {
                  console.error("Failed to save password:", e);
                }
              }
              onSave(sessionToSave);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemeEditor({
  theme,
  onSave,
  onClose,
}: {
  theme: ThemeProfile | null;
  onSave: (theme: ThemeProfile) => void;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<ThemeProfile>(
    theme || {
      name: "Custom",
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#ffffff",
      selectionBackground: "#264f78",
      ansiColors: {
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    }
  );

  const updateColor = (key: string, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const updateAnsiColor = (key: string, value: string) => {
    setProfile((prev) => ({
      ...prev,
      ansiColors: { ...prev.ansiColors, [key]: value },
    }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{theme ? "Edit Theme" : "New Theme"}</h2>
          <button className="modal-close" onClick={onClose}>
            x
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Theme Name</label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => updateColor("name", e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Background</label>
              <input
                type="color"
                value={profile.background}
                onChange={(e) => updateColor("background", e.target.value)}
                style={{ width: "100%", height: 32 }}
              />
            </div>
            <div className="form-group">
              <label>Foreground</label>
              <input
                type="color"
                value={profile.foreground}
                onChange={(e) => updateColor("foreground", e.target.value)}
                style={{ width: "100%", height: 32 }}
              />
            </div>
            <div className="form-group">
              <label>Cursor</label>
              <input
                type="color"
                value={profile.cursor}
                onChange={(e) => updateColor("cursor", e.target.value)}
                style={{ width: "100%", height: 32 }}
              />
            </div>
            <div className="form-group">
              <label>Selection</label>
              <input
                type="color"
                value={profile.selectionBackground}
                onChange={(e) =>
                  updateColor("selectionBackground", e.target.value)
                }
                style={{ width: "100%", height: 32 }}
              />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                marginBottom: 8,
                display: "block",
              }}
            >
              ANSI Colors
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
              }}
            >
              {Object.entries(profile.ansiColors).map(([key, value]) => (
                <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 10 }}>
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </label>
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => updateAnsiColor(key, e.target.value)}
                    style={{ width: "100%", height: 28 }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSave(profile)}>
            Save Theme
          </button>
        </div>
      </div>
    </div>
  );
}

function Settings({
  config,
  themes,
  onSave,
  onEditTheme,
  onNewTheme,
  onClose,
}: {
  config: GlobalConfig;
  themes: ThemeProfile[];
  onSave: (config: GlobalConfig) => void;
  onEditTheme: (theme: ThemeProfile) => void;
  onNewTheme: () => void;
  onClose: () => void;
}) {
  const [cfg, setCfg] = useState<GlobalConfig>({ ...config });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            x
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Default Theme</label>
            <select
              value={cfg.defaultTheme}
              onChange={(e) =>
                setCfg((prev) => ({ ...prev, defaultTheme: e.target.value }))
              }
            >
              {themes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Default Font Family</label>
              <input
                type="text"
                value={cfg.defaultFont.family}
                onChange={(e) =>
                  setCfg((prev) => ({
                    ...prev,
                    defaultFont: { ...prev.defaultFont, family: e.target.value },
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label>Default Font Size</label>
              <input
                type="number"
                value={cfg.defaultFont.size}
                onChange={(e) =>
                  setCfg((prev) => ({
                    ...prev,
                    defaultFont: {
                      ...prev.defaultFont,
                      size: parseInt(e.target.value) || 12,
                    },
                  }))
                }
              />
            </div>
          </div>

          <div className="form-group">
            <label>Quick Connect Protocol</label>
            <select
              value={cfg.quickConnectDefaults.protocol}
              onChange={(e) =>
                setCfg((prev) => ({
                  ...prev,
                  quickConnectDefaults: {
                    ...prev.quickConnectDefaults,
                    protocol: e.target.value,
                  },
                }))
              }
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Logging Defaults</label>
            <div className="form-checkbox">
              <input
                type="checkbox"
                checked={cfg.loggingDefaults.enabled}
                onChange={(e) =>
                  setCfg((prev) => ({
                    ...prev,
                    loggingDefaults: {
                      ...prev.loggingDefaults,
                      enabled: e.target.checked,
                    },
                  }))
                }
              />
              <span>Enable logging by default</span>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Themes
              </label>
              <button className="btn btn-sm" onClick={onNewTheme}>
                + New Theme
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {themes.map((t) => (
                <div
                  key={t.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "6px 10px",
                    background: "var(--bg-tertiary)",
                    borderRadius: 4,
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      background: t.background,
                      border: "1px solid var(--border)",
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 13 }}>{t.name}</span>
                  <button
                    className="btn btn-sm"
                    onClick={() => onEditTheme(t)}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSave(cfg)}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

export { QuickConnect, ProfileEditor, ThemeEditor, Settings };
export default { QuickConnect, ProfileEditor, ThemeEditor, Settings };
