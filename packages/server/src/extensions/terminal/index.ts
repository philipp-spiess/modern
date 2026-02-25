import { randomUUID } from "crypto";
import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";

export const id = "modern.terminal";

interface TerminalSession {
  terminalId: string;
  title: string;
  createdAt: number;
}

export default createExtension(() => {
  const disposables: Disposable[] = [];
  type PanelHandle = ReturnType<typeof modern.window.createReactPanel>;
  const terminalPanels = new Map<string, PanelHandle>();
  let terminalCounter = 0;

  const register = <T extends (...args: any[]) => unknown>(
    command: string,
    handler: T,
    options?: Parameters<typeof modern.commands.registerCommand>[2],
  ) => {
    disposables.push(modern.commands.registerCommand(command, handler, options));
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

    const panel = modern.window.createReactPanel("terminal", "terminal/panel.tsx", title, "terminal-square");
    panel.state = {
      terminalId,
      cwd: cwd ?? modern.project.cwd,
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
