import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { SessionProfile, ThemeProfile } from "../types";

function stripZmodemEscape(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  let i = 0;
  while (i < data.length) {
    if (
      i + 3 < data.length &&
      data[i] === 0x2a &&
      data[i + 1] === 0x2a &&
      data[i + 2] === 0x18
    ) {
      i += 3;
      while (i < data.length && data[i] >= 0x20 && data[i] <= 0x7e) {
        i++;
      }
    } else {
      result.push(data[i]);
      i++;
    }
  }
  return new Uint8Array(result);
}

async function handleZmodemReceive(
  tabId: string,
  terminal: Terminal,
  data: Uint8Array
): Promise<void> {
  const Zmodem = await import("zmodem.js");

  terminal.write("\r\n\x1b[33m[ZMODEM] File transfer detected...\x1b[0m\r\n");

  return new Promise<void>((resolve) => {
    let session: any = null;
    let fileName = "received_file";
    let fileSize = 0;
    let fileData: number[] = [];
    let savePath: string | null = null;
    let firstChunk = true;

    const sentry = new Zmodem.ZSentry({
      on_header(header: any) {
        const typeName = header.constructor.name;

        if (typeName === "ZFile") {
          fileName = header.get_fname();
          fileSize = header.get_file_length() || 0;

          terminal.write(
            `\x1b[33m[ZMODEM] Receiving: ${fileName} (${fileSize} bytes)\x1b[0m\r\n`
          );

          invoke<string | null>("save_file_dialog", {
            defaultPath: fileName,
          }).then((path) => {
            savePath = path;
            if (!savePath) {
              terminal.write("\x1b[31m[ZMODEM] Transfer cancelled by user\x1b[0m\r\n");
              header.skip();
              resolve();
              return;
            }

            terminal.write(`\x1b[32m[ZMODEM] Saving to: ${savePath}\x1b[0m\r\n`);

            header.accept().then((sessionRef: any) => {
              session = sessionRef;
            }).catch(() => {
              resolve();
            });
          }).catch(() => {
            header.skip();
            resolve();
          });
        } else if (typeName === "ZRinit" || typeName === "ZEOF") {
          if (typeName === "ZEOF" && savePath && fileData.length > 0) {
            const bytes = new Uint8Array(fileData);
            invoke("append_file", {
              path: savePath,
              data: Array.from(bytes),
            }).then(() => {
              terminal.write(
                `\x1b[32m[ZMODEM] ${fileName} saved (${fileData.length} bytes)\x1b[0m\r\n`
              );
              fileData = [];
              resolve();
            }).catch((e: any) => {
              terminal.write(`\x1b[31m[ZMODEM] Save error: ${e}\x1b[0m\r\n`);
              resolve();
            });
          } else {
            resolve();
          }
        }
      },
      on_raw(data: Uint8Array) {
        if (firstChunk) {
          firstChunk = false;
          return;
        }
        terminal.write(stripZmodemEscape(data));
      },
    });

    sentry.consume(data);

    const dataDispose = listen(`data-${tabId}`, (event: any) => {
      if (!event.payload?.data) return;
      const incoming = new Uint8Array(event.payload.data);

      try {
        sentry.consume(incoming);
      } catch (e) {
        dataDispose.then((fn) => fn());
        resolve();
      }
    });

    setTimeout(() => {
      dataDispose.then((fn) => fn());
      resolve();
    }, 30000);
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
  const zmodemPending = useRef<Uint8Array[]>([]);

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
      if (!event.payload?.data) return;
      const bytes = new Uint8Array(event.payload.data);

      if (zmodemActive.current) {
        zmodemPending.current.push(bytes);
        return;
      }

      const hasZmodem =
        bytes.length >= 4 &&
        ((bytes[0] === 0x2a && bytes[1] === 0x2a && bytes[2] === 0x18 && (bytes[3] === 0x42 || bytes[3] === 0x43 || bytes[3] === 0x44)) ||
         (bytes.length > 4 && bytes[0] === 0x18 && bytes[1] === 0x42));

      if (hasZmodem || (bytes[0] === 0x18 && bytes[1] === 0x42)) {
        zmodemActive.current = true;
        zmodemPending.current = [bytes];

        handleZmodemReceive(tabId, term, bytes).finally(() => {
          zmodemActive.current = false;
          const pending = zmodemPending.current;
          zmodemPending.current = [];
          for (const chunk of pending) {
            term.write(chunk);
          }
        });
        return;
      }

      term.write(bytes);
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
