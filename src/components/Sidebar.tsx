import { useState } from "react";
import {
  SessionProfile,
  FolderTree,
  TabSession,
} from "../types";

interface SidebarProps {
  sessions: SessionProfile[];
  folders: FolderTree;
  tabs: TabSession[];
  onConnect: (session: SessionProfile) => void;
  onEdit: (session: SessionProfile) => void;
  onDelete: (sessionId: string) => void;
  onDuplicate: (session: SessionProfile) => void;
  onQuickConnect: () => void;
  onNewSession: () => void;
  onSettings: () => void;
}

export default function Sidebar({
  sessions,
  folders,
  tabs,
  onConnect,
  onEdit,
  onDelete,
  onDuplicate,
  onQuickConnect,
  onNewSession,
  onSettings,
}: SidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["Production", "Lab", "Unsorted"])
  );

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const getSessionById = (id: string) =>
    sessions.find((s) => s.id === id);

  const getTabStatus = (sessionId: string) => {
    const tab = tabs.find((t) => t.id === sessionId);
    return tab?.status || "closed";
  };

  const buildTree = () => {
    const folderMap = new Map<string, string[]>();
    const unassigned: string[] = [];

    for (const folder of folders.folders) {
      folderMap.set(folder.path, [...folder.sessions]);
    }

    for (const session of sessions) {
      const isInAnyFolder = folders.folders.some((f) =>
        f.sessions.includes(session.id)
      );
      if (!isInAnyFolder) {
        unassigned.push(session.id);
      }
    }

    const tree: { path: string; sessions: string[]; depth: number }[] = [];

    const allPaths = new Set([...folderMap.keys()]);
    if (unassigned.length > 0) {
      allPaths.add("Unsorted");
      folderMap.set("Unsorted", unassigned);
    }

    const sortedPaths = Array.from(allPaths).sort();

    for (const path of sortedPaths) {
      const depth = path.split("/").length - 1;
      tree.push({
        path,
        sessions: folderMap.get(path) || [],
        depth,
      });
    }

    return tree;
  };

  const tree = buildTree();

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h3>Sessions</h3>
        <div className="sidebar-actions">
          <button className="btn btn-sm" onClick={onNewSession} title="New Session">
            + New
          </button>
          <button className="btn btn-sm" onClick={onQuickConnect} title="Quick Connect">
            Quick Connect
          </button>
        </div>
      </div>

      <div className="sidebar-tree">
        {tree.map((folder) => {
          const isExpanded = expandedFolders.has(folder.path);
          const folderName = folder.path.split("/").pop() || folder.path;

          return (
            <div key={folder.path} className="tree-folder">
              <div
                className="tree-folder-header"
                onClick={() => toggleFolder(folder.path)}
                style={{ paddingLeft: 12 + folder.depth * 16 }}
              >
                <span className="folder-icon">
                  {isExpanded ? "v" : ">"}
                </span>
                <span>{folderName}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    color: "var(--text-muted)",
                  }}
                >
                  {folder.sessions.length}
                </span>
              </div>

              {isExpanded && (
                <div className="tree-sessions">
                  {folder.sessions.map((sessionId) => {
                    const session = getSessionById(sessionId);
                    if (!session) return null;
                    const status = getTabStatus(sessionId);

                    return (
                      <div
                        key={sessionId}
                        className="tree-session"
                        onDoubleClick={() => onConnect(session)}
                      >
                        <span
                          className={`status-dot ${status}`}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            flexShrink: 0,
                            background:
                              status === "connected"
                                ? "var(--success)"
                                : status === "connecting"
                                ? "var(--warning)"
                                : status === "error" || status === "auth-failed"
                                ? "var(--danger)"
                                : "var(--text-muted)",
                          }}
                        />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {session.name}
                        </span>
                        <span
                          className="icon-btn"
                          style={{ fontSize: 10, opacity: 0.5 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(session);
                          }}
                        >
                          ...
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <button className="icon-btn" onClick={onSettings} title="Settings">
          *
        </button>
      </div>
    </div>
  );
}
