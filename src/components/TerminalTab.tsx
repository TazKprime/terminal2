import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { SessionProfile, ThemeProfile } from "../types";

interface TerminalTabProps {
  tabId: string;
  session: SessionProfile;
  themes: ThemeProfile[];
}

export default function TerminalTab({
  tabId,
  session,
  themes,
}: TerminalTabProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const zmodemRef = useRef<any>(null);

  const getThemeColors = useCallback(() => {
    const theme = themes.find((t) => t.name === session.appearance.theme);
    if (theme) {
      return {
        background: session.appearance.colorOverrides.background || theme.background,
        foreground: session.appearance.colorOverrides.foreground || theme.foreground,
        cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
        black: theme.ansiColors.black,
        red: theme.ansiColors.red,
        green: theme.ansiColors.green,
        yellow: theme.ansiColors.yellow,
        blue: theme.ansiColors.blue,
        magenta: theme.ansiColors.magenta,
        cyan: theme.ansiColors.cyan,
        white: theme.ansiColors.white,
        brightBlack: theme.ansiColors.brightBlack,
        brightRed: theme.ansiColors.brightRed,
        brightGreen: theme.ansiColors.brightGreen,
        brightYellow: theme.ansiColors.brightYellow,
        brightBlue: theme.ansiColors.brightBlue,
        brightMagenta: theme.ansiColors.brightMagenta,
        brightCyan: theme.ansiColors.brightCyan,
        brightWhite: theme.ansiColors.brightWhite,
      };
    }
    return {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#ffffff",
      selectionBackground: "#264f78",
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
    };
  }, [session.appearance, themes]);

  const writeToConn = useCallback((data: number[]) => {
    invoke("write_to_connection", {
      sessionId: tabId,
      data,
    }).catch(() => {});
  }, [tabId]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      fontFamily: session.appearance.fontFamily || "Cascadia Mono, monospace",
      fontSize: session.appearance.fontSize || 12,
      lineHeight: session.appearance.lineSpacing || 1.1,
      cursorStyle: session.appearance.cursorStyle as any || "block",
      cursorBlink: session.appearance.cursorBlink,
      scrollback: session.terminal.scrollbackLines || 5000,
      theme: getThemeColors(),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    const container = terminalRef.current;

    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {});
    });

    const handlePasteKey = (e: KeyboardEvent) => {
      if (e.key === "Insert" || (e.ctrlKey && e.key === "v")) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.readText().then((text) => {
          if (text) {
            invoke("write_to_connection", {
              sessionId: tabId,
              data: Array.from(new TextEncoder().encode(text)),
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    };
    container.addEventListener("keydown", handlePasteKey, true);

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (text) {
          invoke("write_to_connection", {
            sessionId: tabId,
            data: Array.from(new TextEncoder().encode(text)),
          }).catch(() => {});
        }
      }).catch(() => {});
    };
    container.addEventListener("contextmenu", handleContextMenu);

    term.onData((data) => {
      invoke("write_to_connection", {
        sessionId: tabId,
        data: Array.from(new TextEncoder().encode(data)),
      }).catch(() => {});
    });

    term.onResize(({ cols, rows }) => {
      invoke("resize_connection", { sessionId: tabId, cols, rows }).catch(() => {});
    });

    const handleResize = () => { try { fitAddon.fit(); } catch (_) {} };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const sc = document.getElementById(`search-${tabId}`);
        if (sc) {
          sc.style.display = sc.style.display === "none" ? "flex" : "none";
          sc.querySelector("input")?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const unlistenData = listen(`data-${tabId}`, (event: any) => {
      if (!event.payload?.data) return;
      const bytes = new Uint8Array(event.payload.data);

      if (zmodemRef.current) {
        try {
          zmodemRef.current.consume(bytes);
        } catch (e) {
          term.write(bytes);
        }
        return;
      }

      const hasZmodem = bytes.length >= 4 &&
        bytes[0] === 0x2a && bytes[1] === 0x2a && bytes[2] === 0x18 &&
        (bytes[3] === 0x42 || bytes[3] === 0x43 || bytes[3] === 0x44);

      if (hasZmodem) {
        initZmodem(bytes, term);
        return;
      }

      term.write(bytes);
    });

    async function initZmodem(initialData: Uint8Array, t: Terminal) {
      const Zmodem = await import("zmodem.js");

      t.write("\r\n\x1b[33m[ZMODEM] Transfer detected...\x1b[0m\r\n");

      let activeSession: any = null;
      let fileSaved = false;

      const sentry = new Zmodem.ZSentry({
        on_header(header: any) {
          const typeName = header?.constructor?.name;

          if (typeName === "ZFile") {
            const fname = header.get_fname();
            const fsize = header.get_file_length();
            t.write(`\x1b[33m[ZMODEM] File: ${fname} (${fsize || "?"} bytes)\x1b[0m\r\n`);

            const p = header.accept();
            if (p && typeof p.then === "function") {
              p.then((session: any) => {
                activeSession = session;
                t.write("\x1b[32m[ZMODEM] Accepted, waiting for data...\x1b[0m\r\n");
              }).catch(() => {
                t.write("\x1b[31m[ZMODEM] Session error\x1b[0m\r\n");
                zmodemRef.current = null;
              });
            } else if (p && typeof p.on === "function") {
              activeSession = p;
            }
            return;
          }

          if (typeName === "ZRinit") {
            return;
          }

          if (typeName === "ZEOF") {
            t.write("\x1b[32m[ZMODEM] Transfer complete.\x1b[0m\r\n");
            zmodemRef.current = null;
            return;
          }

          if (typeName === "ZFIN") {
            t.write("\x1b[32m[ZMODEM] Finished.\x1b[0m\r\n");
            zmodemRef.current = null;
            return;
          }
        },
        on_raw(data: Uint8Array) {
          if (data.length > 0) {
            t.write(data);
          }
        },
      });

      zmodemRef.current = sentry;

      try {
        sentry.consume(initialData);
      } catch (e) {
        t.write(`\x1b[31m[ZMODEM] Parse error: ${e}\x1b[0m\r\n`);
        zmodemRef.current = null;
      }
    }

    return () => {
      unlistenData.then((fn) => fn());
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("keydown", handlePasteKey, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [tabId]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getThemeColors();
      xtermRef.current.options.fontFamily =
        session.appearance.fontFamily || "Cascadia Mono, monospace";
      xtermRef.current.options.fontSize = session.appearance.fontSize || 12;
      xtermRef.current.options.lineHeight = session.appearance.lineSpacing || 1.1;
      xtermRef.current.options.cursorStyle =
        session.appearance.cursorStyle as any || "block";
      xtermRef.current.options.cursorBlink = session.appearance.cursorBlink;
    }
  }, [session.appearance, themes]);

  const handleSearch = (direction: "next" | "prev") => {
    if (searchAddonRef.current) {
      const input = document.querySelector(
        `#search-${tabId} input`
      ) as HTMLInputElement;
      if (input?.value) {
        if (direction === "next") {
          searchAddonRef.current.findNext(input.value);
        } else {
          searchAddonRef.current.findPrevious(input.value);
        }
      }
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        id={`search-${tabId}`}
        className="search-bar"
        style={{ display: "none" }}
      >
        <input
          type="text"
          placeholder="Search..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSearch(e.shiftKey ? "prev" : "next");
            }
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
              const sc = document.getElementById(`search-${tabId}`);
              if (sc) sc.style.display = "none";
            }
          }}
        />
        <button className="icon-btn" onClick={() => handleSearch("prev")}>^</button>
        <button className="icon-btn" onClick={() => handleSearch("next")}>v</button>
      </div>
      <div ref={terminalRef} className="terminal-wrapper" />
    </div>
  );
}
