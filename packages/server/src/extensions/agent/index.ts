import path from "node:path";
import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";

export const id = "modern.agent";

interface OpenPanelArgs {
  threadPath: string;
  title?: string;
}

interface AgentPanelState {
  threadPath: string;
}

export default createExtension(() => {
  const disposables: Disposable[] = [];
  type PanelHandle = ReturnType<typeof modern.window.createReactPanel>;
  const threadPanels = new Map<string, PanelHandle>();

  const register = <T extends (...args: any[]) => unknown>(
    command: string,
    handler: T,
    options?: Parameters<typeof modern.commands.registerCommand>[2],
  ) => {
    disposables.push(modern.commands.registerCommand(command, handler, options));
  };

  const openPanel = (input: OpenPanelArgs | string) => {
    const args = normalizeOpenPanelArgs(input);
    const threadPath = path.resolve(modern.project.cwd, args.threadPath);

    let panel = threadPanels.get(threadPath);
    const title = resolveTitle(args.title, threadPath);

    if (!panel) {
      panel = modern.window.createReactPanel("agent.chat", "agent/chat.tsx", title, "message-square");
      threadPanels.set(threadPath, panel);
    } else {
      panel.title = title;
    }

    panel.state = {
      threadPath,
    } satisfies AgentPanelState;

    return {
      panelId: panel.id,
      threadPath,
    };
  };

  register("agent.openPanel", openPanel);

  return createDisposable(() => {
    for (const panel of threadPanels.values()) {
      panel[Symbol.dispose]();
    }

    threadPanels.clear();
    return [...disposables];
  });
});

function normalizeOpenPanelArgs(input: OpenPanelArgs | string | undefined): OpenPanelArgs {
  if (typeof input === "string") {
    return {
      threadPath: input,
    };
  }

  if (!input?.threadPath?.trim()) {
    throw new Error("agent.openPanel requires a threadPath argument.");
  }

  return input;
}

function resolveTitle(rawTitle: string | undefined, threadPath: string): string {
  const title = rawTitle?.trim();
  if (title) {
    return title;
  }

  const fileName = path.basename(threadPath).replace(/\.jsonl$/i, "");
  return fileName || "Thread";
}
