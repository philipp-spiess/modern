import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { init, Terminal, FitAddon } from "ghostty-web";
import { useEffect, useRef, useState } from "react";
import { commands, type ExtensionPanelProps } from "../../lib/extensions";
import { useSettings } from "../../lib/settings";

// Theme colors from theme.json (terminal.* keys)
const terminalTheme = {
  background: "#121212",
  foreground: "#dbd7caee",
  cursor: "#dbd7caee",
  cursorAccent: "#121212",
  selectionBackground: "#eeeeee18",
  black: "#393a34",
  red: "#cb7676",
  green: "#4d9375",
  yellow: "#e6cc77",
  blue: "#6394bf",
  magenta: "#d9739f",
  cyan: "#5eaab5",
  white: "#dbd7ca",
  brightBlack: "#777777",
  brightRed: "#cb7676",
  brightGreen: "#4d9375",
  brightYellow: "#e6cc77",
  brightBlue: "#6394bf",
  brightMagenta: "#d9739f",
  brightCyan: "#5eaab5",
  brightWhite: "#ffffff",
};

type PtyDataPayload = {
  id: string;
  data: string;
};

type PtyExitPayload = {
  id: string;
  code: number;
  message?: string | null;
};

interface TerminalPanelState {
  terminalId: string;
  cwd?: string;
}

const ghosttyReady = init();

export default function TerminalPanel({ state, workspaceCwd }: ExtensionPanelProps<TerminalPanelState>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const initialFitRafRef = useRef<number | null>(null);
  const resizeFitRafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "exited">("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);

  const editorSettings = useSettings((cfg) => cfg.editor);

  useEffect(() => {
    if (!containerRef.current || !layoutRef.current) return;

    const container = containerRef.current;
    const layout = layoutRef.current;
    let disposed = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let inputDisposable: { dispose(): void } | null = null;
    let resizeDisposable: { dispose(): void } | null = null;
    let titleDisposable: { dispose(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    const setup = async () => {
      await Promise.all([ghosttyReady, document.fonts.ready]);
      if (disposed) return;

      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: `"${editorSettings.fontFamily}", monospace`,
        fontSize: editorSettings.fontSize,
        scrollback: 1000,
        smoothScrollDuration: 0,
        theme: terminalTheme,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.open(container);

      // In ghostty-web, returning true = "handled, skip ghostty processing" (opposite of xterm.js)
      terminal.attachCustomKeyEventHandler((e) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey) {
          const key = e.key.toLowerCase();
          if (key === "t" || key === "w" || key === "n" || key === "," || key === "p" || key === "k") {
            return true;
          }
        }
        return false;
      });

      const fitTerminal = () => {
        if (disposed) return;
        if (!terminal?.element || !terminal.element.isConnected) return;

        const parent = terminal.element.parentElement;
        if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return;

        try {
          fitAddon!.fit();
        } catch {
          // FitAddon can throw when renderer is not ready yet
        }
      };

      // Disable dockview transform animations for this view to avoid one-frame stretching.
      const dockviewView = container.closest(".dv-view");
      dockviewView?.classList.add("dv-view-terminal");

      // Initial fit after the first frame, then once more on the next frame.
      initialFitRafRef.current = requestAnimationFrame(() => {
        fitTerminal();
        initialFitRafRef.current = requestAnimationFrame(() => {
          fitTerminal();
        });
      });

      // Re-measure font metrics and re-fit after web fonts are ready.
      if ("fonts" in document) {
        void document.fonts.ready.then(() => {
          if (disposed) return;
          terminal!.renderer?.remeasureFont();
          fitTerminal();
        });
      }

      // Keep terminal in sync with layout changes.
      resizeObserver = new ResizeObserver(() => {
        if (resizeFitRafRef.current) {
          cancelAnimationFrame(resizeFitRafRef.current);
        }
        resizeFitRafRef.current = requestAnimationFrame(() => {
          fitTerminal();
        });
      });
      resizeObserver.observe(layout);

      // Forward user input to PTY
      inputDisposable = terminal.onData((data) => {
        if (sessionIdRef.current) {
          invoke("write_to_pty", { id: sessionIdRef.current, data }).catch(console.error);
        }
      });

      // Forward resize events
      resizeDisposable = terminal.onResize(({ cols, rows }) => {
        if (sessionIdRef.current) {
          invoke("resize_pty", { id: sessionIdRef.current, cols, rows }).catch(console.error);
        }
      });

      // Listen for terminal title changes (from OSC escape sequences)
      titleDisposable = terminal.onTitleChange((title) => {
        if (title && state.terminalId) {
          commands
            .execute("terminal.setTitle", { terminalId: state.terminalId, title }, { cwd: workspaceCwd })
            .catch(console.error);
        }
      });

      // Set up event listeners
      unlistenData = await listen<PtyDataPayload>("pty://data", (event) => {
        if (event.payload.id === sessionIdRef.current) {
          terminal!.write(event.payload.data);
        }
      });

      unlistenExit = await listen<PtyExitPayload>("pty://exit", (event) => {
        if (event.payload.id === sessionIdRef.current) {
          setStatus("exited");
          setExitCode(event.payload.code);
          terminal!.writeln("");
          const extra = event.payload.message ? ` - ${event.payload.message}` : "";
          terminal!.writeln(`\u001b[90mProcess exited (code: ${event.payload.code}${extra})\u001b[0m`);
          sessionIdRef.current = null;
        }
      });

      // Start the PTY session
      fitTerminal();

      try {
        const { id } = await invoke<{ id: string }>("spawn_pty", {
          options: {
            cols: terminal.cols || 80,
            rows: terminal.rows || 24,
            cwd: state.cwd,
          },
        });
        sessionIdRef.current = id;
        setStatus("live");
        terminal.focus();

        // Send initial resize after session starts
        requestAnimationFrame(() => {
          if (sessionIdRef.current && terminal) {
            invoke("resize_pty", {
              id: sessionIdRef.current,
              cols: terminal.cols,
              rows: terminal.rows,
            }).catch(console.error);
          }
        });
      } catch (error) {
        console.error("Failed to spawn PTY:", error);
        setStatus("exited");
        terminal.writeln(`\u001b[31mFailed to start terminal: ${error}\u001b[0m`);
      }
    };

    setup().catch(console.error);

    return () => {
      disposed = true;
      if (initialFitRafRef.current) {
        cancelAnimationFrame(initialFitRafRef.current);
        initialFitRafRef.current = null;
      }
      if (resizeFitRafRef.current) {
        cancelAnimationFrame(resizeFitRafRef.current);
        resizeFitRafRef.current = null;
      }

      inputDisposable?.dispose();
      resizeDisposable?.dispose();
      titleDisposable?.dispose();
      resizeObserver?.disconnect();
      const dockviewView = container.closest(".dv-view");
      dockviewView?.classList.remove("dv-view-terminal");
      unlistenData?.();
      unlistenExit?.();

      const sessionId = sessionIdRef.current;
      if (sessionId) {
        invoke("close_pty", { id: sessionId }).catch(() => {
          /* PTY might already be gone */
        });
      }
      sessionIdRef.current = null;
      fitAddonRef.current = null;
      terminalRef.current = null;

      terminal?.dispose();
    };
  }, [state.cwd, state.terminalId, workspaceCwd, editorSettings.fontFamily, editorSettings.fontSize]);

  return (
    <div className="flex size-full flex-col" style={{ backgroundColor: terminalTheme.background }}>
      <div ref={layoutRef} className="flex flex-1 flex-col overflow-hidden py-2 px-3">
        <div ref={containerRef} className="flex-1 overflow-hidden" style={{ minHeight: 0 }} />
      </div>
      {status === "exited" && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs border-t"
          style={{
            color: "#959da5",
            borderColor: "#191919",
            backgroundColor: terminalTheme.background,
          }}
        >
          <span>Process exited{exitCode !== null ? ` with code ${exitCode}` : ""}</span>
          <button
            className="px-2 py-0.5 rounded transition-colors"
            style={{
              backgroundColor: "#181818",
              color: "#dbd7caee",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#222222";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#181818";
            }}
            onClick={() => {
              if (terminalRef.current && fitAddonRef.current) {
                terminalRef.current.reset();
                setStatus("connecting");
                setExitCode(null);

                try {
                  fitAddonRef.current.fit();
                } catch {
                  // Ignore
                }

                invoke<{ id: string }>("spawn_pty", {
                  options: {
                    cols: terminalRef.current.cols || 80,
                    rows: terminalRef.current.rows || 24,
                    cwd: state.cwd,
                  },
                })
                  .then(({ id }) => {
                    sessionIdRef.current = id;
                    setStatus("live");
                    terminalRef.current?.focus();

                    // Send resize after restart
                    requestAnimationFrame(() => {
                      if (sessionIdRef.current && terminalRef.current) {
                        invoke("resize_pty", {
                          id: sessionIdRef.current,
                          cols: terminalRef.current.cols,
                          rows: terminalRef.current.rows,
                        }).catch(console.error);
                      }
                    });
                  })
                  .catch((error) => {
                    console.error("Failed to restart PTY:", error);
                    setStatus("exited");
                    terminalRef.current?.writeln(`\u001b[31mFailed to restart terminal: ${error}\u001b[0m`);
                  });
              }
            }}
          >
            Restart
          </button>
        </div>
      )}
    </div>
  );
}
