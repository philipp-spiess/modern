import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { useEffect, useRef, useState } from "react";
import { commands, type ExtensionPanelProps } from "../../lib/extensions";
import { useSettings } from "../../lib/settings";
import "@xterm/xterm/css/xterm.css";

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

    // VSCode-like xterm.js configuration
    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: false,
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      drawBoldTextInBrightColors: true,
      fastScrollSensitivity: 5,
      fontFamily: `${editorSettings.fontFamily}, monospace`,
      fontSize: editorSettings.fontSize,
      fontWeight: "normal",
      fontWeightBold: "bold",
      lineHeight: 1.0,
      letterSpacing: 0,
      minimumContrastRatio: 4.5,
      scrollback: 1000,
      scrollSensitivity: 1,
      smoothScrollDuration: 0,
      tabStopWidth: 8,
      theme: terminalTheme,
    });

    // Load addons
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Unicode11 addon for better unicode support
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.open(containerRef.current);

    // Try to load WebGL addon for better rendering (like VSCode)
    // This prevents emoji rendering and handles ASCII art better
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      console.warn("WebGL addon failed to load, using default renderer");
    }

    let disposed = false;

    const fitTerminal = () => {
      if (disposed) return;

      const currentTerminal = terminalRef.current;
      if (!currentTerminal?.element || !currentTerminal.element.isConnected) return;

      const parent = currentTerminal.element.parentElement;
      if (!parent || parent.clientWidth === 0 || parent.clientHeight === 0) return;

      // Guard against transient renderer teardown/creation while Dockview re-lays out panes.
      const hasRenderer = Boolean((currentTerminal as any)?._core?._renderService?._renderer?.value);
      if (!hasRenderer) return;

      try {
        fitAddon.fit();
      } catch {
        // FitAddon can throw when renderer is not ready yet
      }
    };

    // Disable dockview transform animations for this view to avoid one-frame xterm stretching.
    const dockviewView = containerRef.current.closest(".dv-view");
    dockviewView?.classList.add("dv-view-terminal");

    // Initial fit after the first frame, then once more on the next frame.
    initialFitRafRef.current = requestAnimationFrame(() => {
      fitTerminal();
      initialFitRafRef.current = requestAnimationFrame(() => {
        fitTerminal();
      });
    });

    // Re-fit after web fonts are ready to prevent fallback-metric flicker.
    if ("fonts" in document) {
      void document.fonts.ready.then(() => {
        if (disposed) return;
        fitTerminal();
      });
    }

    // Keep xterm in sync with layout changes.
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFitRafRef.current) {
        cancelAnimationFrame(resizeFitRafRef.current);
      }
      resizeFitRafRef.current = requestAnimationFrame(() => {
        fitTerminal();
      });
    });
    resizeObserver.observe(layoutRef.current);

    // Forward user input to PTY
    const inputDisposable = terminal.onData((data) => {
      if (sessionIdRef.current) {
        invoke("write_to_pty", { id: sessionIdRef.current, data }).catch(console.error);
      }
    });

    // Forward resize events from xterm.js
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) {
        invoke("resize_pty", { id: sessionIdRef.current, cols, rows }).catch(console.error);
      }
    });

    // Listen for terminal title changes (from OSC escape sequences)
    const titleDisposable = terminal.onTitleChange((title) => {
      if (title && state.terminalId) {
        commands
          .execute("terminal.setTitle", { terminalId: state.terminalId, title }, { cwd: workspaceCwd })
          .catch(console.error);
      }
    });

    // Set up event listeners
    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    const setupListeners = async () => {
      unlistenData = await listen<PtyDataPayload>("pty://data", (event) => {
        if (event.payload.id === sessionIdRef.current) {
          terminal.write(event.payload.data);
        }
      });

      unlistenExit = await listen<PtyExitPayload>("pty://exit", (event) => {
        if (event.payload.id === sessionIdRef.current) {
          setStatus("exited");
          setExitCode(event.payload.code);
          terminal.writeln("");
          const extra = event.payload.message ? ` - ${event.payload.message}` : "";
          terminal.writeln(`\u001b[90mProcess exited (code: ${event.payload.code}${extra})\u001b[0m`);
          sessionIdRef.current = null;
        }
      });
    };

    // Start the PTY session
    const startSession = async () => {
      // Ensure we have proper dimensions before starting
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
          if (sessionIdRef.current) {
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

    setupListeners().then(startSession).catch(console.error);

    return () => {
      // Cleanup
      disposed = true;
      if (initialFitRafRef.current) {
        cancelAnimationFrame(initialFitRafRef.current);
        initialFitRafRef.current = null;
      }
      if (resizeFitRafRef.current) {
        cancelAnimationFrame(resizeFitRafRef.current);
        resizeFitRafRef.current = null;
      }

      inputDisposable.dispose();
      resizeDisposable.dispose();
      titleDisposable.dispose();
      resizeObserver.disconnect();
      dockviewView?.classList.remove("dv-view-terminal");
      unlistenData?.();
      unlistenExit?.();

      // Close PTY session
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        invoke("close_pty", { id: sessionId }).catch(() => {
          /* PTY might already be gone */
        });
      }
      sessionIdRef.current = null;
      fitAddonRef.current = null;
      terminalRef.current = null;

      terminal.dispose();
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
