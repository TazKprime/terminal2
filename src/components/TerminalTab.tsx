import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { SessionProfile, ThemeProfile } from "../types";

const ZMODEM_SEQUENCE = new Uint8Array([0x2a, 0x2a, 0x18, 0x42]); // **\x18B

function hasZmodemSequence(data: Uint8Array): boolean {
  for (let i = 0; i <= data.length - 4; i++) {
    if (
      data[i] === 0x2a &&
      data[i + 1] === 0x2a &&
      data[i + 2] === 0x18 &&
      data[i + 3] === 0x42
    ) {
      return true;
    }
  }
  return false;
}

async function handleZmodemReceive(
  tabId: string,
  terminal: Terminal
): Promise<void> {
  const { ZSentry, ZmodemBrowser } = await import("zmodem.js");

  terminal.write("\r\n[ZMODEM] Receiving file...\r\n");

  return new Promise((resolve) => {
    let activeSession: any = null;

    const sentry = new ZSentry({
      on_header(header: any) {
        if (header.constructor.name === "ZFile") {
          const fname = header.get_fname();
          const fsize = header.get_file_length();

          terminal.write(
            `\r\n[ZMODEM] File: ${fname} (${fsize} bytes)\r\n`
          );

          const savePathPromise = invoke<string>("save_file_dialog", {
            defaultPath: fname,
          }).catch(() => null);

          savePathPromise.then((savePath) => {
            if (!savePath) {
              terminal.write("[ZMODEM] Transfer cancelled.\r\n");
              if (activeSession) {
                activeSession.close();
              }
              resolve();
              return;
            }

            const session = ZmodemBrowser.receive(
              [
                {
                  on_header(h: any) {
                    header = h;
                  },
                },
              ],
              {
                on_input(data: Uint8Array) {
                  invoke("append_file", {
                    path: savePath,
                    data: Array.from(data),
                  }).catch(() => {});
                },
              }
            );

            activeSession = session;

            const check = header.check;
            if (check) {
              activeSession.file_length = header.get_file_length();
              activeSession.fname = header.get_fname();
            }

            terminal.write(
              `[ZMODEM] Saving to ${savePath}...\r\n`
            );

            invoke("write_to_connection", {
              sessionId: tabId,
              data: Array.from(new Uint8Array([0x06])), // ACK
            }).catch(() => {});
          });
        } else {
          terminal.write("[ZMODEM] Transfer complete.\r\n");
          resolve();
        }
      },

      on_raw(data: Uint8Array) {
        const stripped = new Uint8Array(data.length);
        let j = 0;
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== 0x18) {
            stripped[j++] = data[i];
          }
        }
        terminal.write(stripped.slice(0, j));
      },
    });

    const disposeData = terminal.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      try {
        sentry.consume(bytes);
      } catch (e) {
        disposeData.dispose();
        terminal.write("\r\n[ZMODEM] Error: " + String(e) + "\r\n");
        resolve();
      }
    });
  });
}

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
  const zmodemActive = useRef(false);

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
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    });

    const handlePasteKey = (e: KeyboardEvent) => {
      if (e.key === "Insert" || (e.ctrlKey && e.key === "v")) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.readText().then((text) => {
          if (text && xtermRef.current) {
            const bytes = new TextEncoder().encode(text);
            invoke("write_to_connection", {
              sessionId: tabId,
              data: Array.from(bytes),
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    };
    container.addEventListener("keydown", handlePasteKey, true);

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (text && xtermRef.current) {
          const bytes = new TextEncoder().encode(text);
          invoke("write_to_connection", {
            sessionId: tabId,
            data: Array.from(bytes),
          }).catch(() => {});
        }
      }).catch(() => {});
    };
    container.addEventListener("contextmenu", handleContextMenu);

    term.onData((data) => {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(data);
      invoke("write_to_connection", {
        sessionId: tabId,
        data: Array.from(bytes),
      }).catch((e) => console.error("Write failed:", e));
    });

    term.onResize(({ cols, rows }) => {
      invoke("resize_connection", {
        sessionId: tabId,
        cols,
        rows,
      }).catch(() => {});
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch (e) {
        // ignore
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);
    window.addEventListener("resize", handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const searchContainer = document.getElementById(`search-${tabId}`);
        if (searchContainer) {
          searchContainer.style.display =
            searchContainer.style.display === "none" ? "flex" : "none";
          const input = searchContainer?.querySelector("input");
          if (input) input.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const unlistenData = listen(`data-${tabId}`, (event: any) => {
      if (event.payload?.data) {
        const bytes = new Uint8Array(event.payload.data);

        if (!zmodemActive.current && hasZmodemSequence(bytes)) {
          zmodemActive.current = true;
          handleZmodemReceive(tabId, term).finally(() => {
            zmodemActive.current = false;
          });
          return;
        }

        if (xtermRef.current) {
          xtermRef.current.write(bytes);
        }
      }
    });

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
              const container = document.getElementById(`search-${tabId}`);
              if (container) container.style.display = "none";
            }
          }}
        />
        <button className="icon-btn" onClick={() => handleSearch("prev")}>
          ^
        </button>
        <button className="icon-btn" onClick={() => handleSearch("next")}>
          v
        </button>
      </div>
      <div ref={terminalRef} className="terminal-wrapper" />
    </div>
  );
}
