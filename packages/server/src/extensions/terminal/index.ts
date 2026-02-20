import { randomUUID } from "crypto";
import { createExtension, diffs } from "../../extension";
import { createDisposable } from "../../utils/disposable";

export const id = "diffs.terminal";

interface TerminalSession {
  terminalId: string;
  title: string;
  createdAt: number;
}

export default createExtension(() => {
  const disposables: Disposable[] = [];
  type PanelHandle = ReturnType<typeof diffs.window.createReactPanel>;
  const terminalPanels = new Map<string, PanelHandle>();
  let terminalCounter = 0;

  const register = <T extends (...args: any[]) => unknown>(
    command: string,
    handler: T,
    options?: Parameters<typeof diffs.commands.registerCommand>[2],
  ) => {
    disposables.push(diffs.commands.registerCommand(command, handler, options));
  };

  const createTerminal = (cwd?: string): TerminalSession => {
    terminalCounter += 1;
    const terminalId = randomUUID();
    const title = `Terminal ${terminalCounter}`;
    const session: TerminalSession = {
      terminalId,
      title,
      createdAt: Date.now(),
    };

    const panel = diffs.window.createReactPanel("terminal", "terminal/panel.tsx", title, "terminal-square");
    panel.state = {
      terminalId,
      cwd: cwd ?? diffs.workspace.cwd,
    };
    terminalPanels.set(terminalId, panel);

    return session;
  };

  register("terminal.new", (cwd?: string) => createTerminal(cwd), {
    title: "Terminal: New Terminal",
    defaultKeybinding: { key: "cmd+t", scope: "global" },
  });

  register("terminal.dispose", (terminalId: string) => {
    const panel = terminalPanels.get(terminalId);
    if (panel) {
      panel[Symbol.dispose]();
      terminalPanels.delete(terminalId);
    }
  });

  register("terminal.setTitle", ({ terminalId, title }: { terminalId: string; title: string }) => {
    const panel = terminalPanels.get(terminalId);
    if (panel && title?.trim()) {
      panel.title = title.trim();
    }
  });

  return createDisposable(() => {
    for (const panel of terminalPanels.values()) {
      panel[Symbol.dispose]();
    }
    terminalPanels.clear();
    return [...disposables];
  });
});
