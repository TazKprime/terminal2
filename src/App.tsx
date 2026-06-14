import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import Sidebar from "./components/Sidebar";
import TerminalTab from "./components/TerminalTab";
import Modals from "./components/Modals";
import {
  GlobalConfig,
  SessionProfile,
  FolderTree,
  ThemeProfile,
  TabSession,
  DEFAULT_SESSION,
} from "./types";

type ModalType =
  | null
  | "quickConnect"
  | "profileEditor"
  | "folderEditor"
  | "themeEditor"
  | "settings";

export default function App() {
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [sessions, setSessions] = useState<SessionProfile[]>([]);
  const [folders, setFolders] = useState<FolderTree>({ folders: [] });
  const [themes, setThemes] = useState<ThemeProfile[]>([]);
  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalType>(null);
  const [editingSession, setEditingSession] = useState<SessionProfile | null>(null);
  const [editingTheme, setEditingTheme] = useState<ThemeProfile | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ session: SessionProfile; resolve: (pw: string | null) => void } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const promptPassword = (session: SessionProfile): Promise<string | null> => {
    return new Promise((resolve) => {
      setPasswordPrompt({ session, resolve });
    });
  };

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    tabs.forEach((tab) => {
      const statusUnlisten = listen(`status-${tab.id}`, (event: any) => {
        const { status } = event.payload;
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id ? { ...t, status } : t
          )
        );
      });
      unlisteners.push(() => statusUnlisten.then((fn) => fn()));
    });

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [tabs]);

  const loadData = async () => {
    try {
      const [cfg, s, f, t] = await Promise.all([
        invoke<GlobalConfig>("get_global_config"),
        invoke<SessionProfile[]>("get_sessions"),
        invoke<FolderTree>("get_folders"),
        invoke<ThemeProfile[]>("get_themes"),
      ]);
      setConfig(cfg);
      setSessions(s);
      setFolders(f);
      setThemes(t);
    } catch (e) {
      console.error("Failed to load data:", e);
    }
  };

  const handleConnect = useCallback(
    async (session: SessionProfile, password?: string) => {
      let effectivePassword = password || null;

      if (
        !effectivePassword &&
        session.protocol === "ssh2" &&
        session.connection.authMethod === "password"
      ) {
        effectivePassword = await promptPassword(session);
        if (effectivePassword === null) return;
      }

      const tabId = session.id || `quick-${Date.now()}`;
      const tabSession: TabSession = {
        id: tabId,
        name: session.name,
        status: "connecting",
        profile: { ...session, id: tabId },
      };

      setTabs((prev) => [...prev, tabSession]);
      setActiveTab(tabId);

      try {
        await invoke("connect_session", {
          session: { ...session, id: tabId },
          password: effectivePassword,
        });
      } catch (e) {
        console.error("Connect failed:", e);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId ? { ...t, status: "error" } : t
          )
        );
      }
    },
    []
  );

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      try {
        await invoke("disconnect_session", { sessionId: tabId });
      } catch (e) {
        console.error("Disconnect failed:", e);
      }

      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      setActiveTab((prev) => {
        if (prev === tabId) {
          const remaining = tabs.filter((t) => t.id !== tabId);
          return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        }
        return prev;
      });
    },
    [tabs]
  );

  const handleSaveSession = useCallback(
    async (session: SessionProfile) => {
      try {
        if (session.id) {
          await invoke("save_session_profile", { session });
        } else {
          const newSession = {
            ...session,
            id: `sess-${Date.now()}`,
          };
          await invoke("save_session_profile", { session: newSession });

          const newFolders = { ...folders };
          const folderPath = newSession.folder || "Unsorted";
          const existing = newFolders.folders.find((f) => f.path === folderPath);
          if (existing) {
            existing.sessions.push(newSession.id);
          } else {
            newFolders.folders.push({
              path: folderPath,
              sessions: [newSession.id],
            });
          }
          await invoke("set_folders", { folders: newFolders });
          setFolders(newFolders);
        }
        await loadData();
      } catch (e) {
        console.error("Save failed:", e);
      }
    },
    [folders]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await invoke("delete_session_profile", { sessionId });

        const newFolders = { ...folders };
        for (const folder of newFolders.folders) {
          folder.sessions = folder.sessions.filter((s) => s !== sessionId);
        }
        newFolders.folders = newFolders.folders.filter(
          (f) => f.sessions.length > 0
        );
        await invoke("set_folders", { folders: newFolders });
        setFolders(newFolders);

        await loadData();
      } catch (e) {
        console.error("Delete failed:", e);
      }
    },
    [folders]
  );

  const handleDuplicateSession = useCallback(
    async (session: SessionProfile) => {
      const duplicated: SessionProfile = {
        ...session,
        id: "",
        name: `${session.name} (Copy)`,
      };
      setEditingSession(duplicated);
      setModal("profileEditor");
    },
    []
  );

  const handleSaveTheme = useCallback(
    async (theme: ThemeProfile) => {
      try {
        await invoke("save_theme_profile", { theme });
        await loadData();
      } catch (e) {
        console.error("Save theme failed:", e);
      }
    },
    []
  );

  return (
    <div className="app-layout">
      <Sidebar
        sessions={sessions}
        folders={folders}
        tabs={tabs}
        onConnect={handleConnect}
        onEdit={(session) => {
          setEditingSession(session);
          setModal("profileEditor");
        }}
        onDelete={handleDeleteSession}
        onDuplicate={handleDuplicateSession}
        onQuickConnect={() => setModal("quickConnect")}
        onNewSession={() => {
          setEditingSession(null);
          setModal("profileEditor");
        }}
        onSettings={() => setModal("settings")}
      />
      <div className="main-area">
        {tabs.length > 0 && (
          <div className="tabs-bar">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background:
                      tab.status === "connected"
                        ? "var(--success)"
                        : tab.status === "connecting"
                        ? "var(--warning)"
                        : tab.status === "error" || tab.status === "auth-failed"
                        ? "var(--danger)"
                        : "var(--text-muted)",
                  }}
                />
                <span className="tab-title">{tab.name}</span>
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                >
                  x
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="terminal-container">
          {tabs.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 48, opacity: 0.3 }}>{">_"}</div>
              <p>No active sessions</p>
              <p style={{ fontSize: 12 }}>
                Open a session from the sidebar or use Quick Connect
              </p>
            </div>
          ) : (
            tabs.map((tab) => (
              <div
                key={tab.id}
                style={{
                  display: activeTab === tab.id ? "block" : "none",
                  width: "100%",
                  height: "100%",
                }}
              >
                <TerminalTab
                  tabId={tab.id}
                  session={tab.profile}
                  themes={themes}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {modal === "quickConnect" && (
        <Modals.QuickConnect
          config={config}
          onConnect={(session, password) => {
            handleConnect(session, password);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === "profileEditor" && (
        <Modals.ProfileEditor
          session={editingSession}
          onSave={(session) => {
            handleSaveSession(session);
            setModal(null);
            setEditingSession(null);
          }}
          onClose={() => {
            setModal(null);
            setEditingSession(null);
          }}
        />
      )}

      {modal === "themeEditor" && (
        <Modals.ThemeEditor
          theme={editingTheme}
          onSave={(theme) => {
            handleSaveTheme(theme);
            setModal(null);
            setEditingTheme(null);
          }}
          onClose={() => {
            setModal(null);
            setEditingTheme(null);
          }}
        />
      )}

      {modal === "settings" && config && (
        <Modals.Settings
          config={config}
          themes={themes}
          onSave={async (cfg) => {
            try {
              await invoke("set_global_config", { cfg });
              setConfig(cfg);
              setModal(null);
            } catch (e) {
              console.error("Save config failed:", e);
            }
          }}
          onEditTheme={(theme) => {
            setEditingTheme(theme);
            setModal("themeEditor");
          }}
          onNewTheme={() => {
            setEditingTheme(null);
            setModal("themeEditor");
          }}
          onClose={() => setModal(null)}
        />
      )}

      {passwordPrompt && (
        <PasswordPrompt
          sessionName={passwordPrompt.session.name}
          onSubmit={(pw) => {
            passwordPrompt.resolve(pw);
            setPasswordPrompt(null);
          }}
          onCancel={() => {
            passwordPrompt.resolve(null);
            setPasswordPrompt(null);
          }}
        />
      )}
    </div>
  );
}

function PasswordPrompt({
  sessionName,
  onSubmit,
  onCancel,
}: {
  sessionName: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const inputRef = useState<HTMLInputElement | null>(null);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Password Required</h2>
          <button className="modal-close" onClick={onCancel}>x</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, marginBottom: 12, color: "var(--text-secondary)" }}>
            Enter password for <strong>{sessionName}</strong>
          </p>
          <div className="form-group">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) onSubmit(password);
                if (e.key === "Escape") onCancel();
              }}
              placeholder="Password"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => password && onSubmit(password)}>Connect</button>
        </div>
      </div>
    </div>
  );
}
