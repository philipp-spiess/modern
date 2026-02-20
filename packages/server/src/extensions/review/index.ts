import path from "node:path";
import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";

export const id = "modern.review";

export type DiffMode = "staged" | "worktree";

export default createExtension(async () => {
  const cwd = modern.workspace.cwd;
  if (!cwd) throw new Error("Workspace cwd is not available.");

  const disposables: Disposable[] = [];
  type PanelHandle = ReturnType<typeof modern.window.createReactPanel>;
  const diffPanels = new Map<string, PanelHandle>();

  const register = <T extends (...args: any[]) => unknown>(
    command: string,
    handler: T,
    options?: Parameters<typeof modern.commands.registerCommand>[2],
  ) => {
    disposables.push(modern.commands.registerCommand(command, handler, options));
  };

  const openDiff = (filePath: string, mode: DiffMode) => {
    const panelKey = `${filePath}:${mode}`;
    let panel = diffPanels.get(panelKey);
    if (!panel) {
      const filename = path.basename(filePath);
      const title = `${filename} (${mode === "staged" ? "Staged" : "Working Tree"})`;
      panel = modern.window.createReactPanel("review.diff", "review/diff-view.tsx", title);
      panel.state = { path: filePath, mode };
      diffPanels.set(panelKey, panel);
    } else {
      panel.state = { path: filePath, mode };
    }
    return { path: filePath, mode };
  };

  register("review.openDiff", (filePath: string, mode: DiffMode) => openDiff(filePath, mode));

  return createDisposable(() => {
    for (const panel of diffPanels.values()) {
      panel[Symbol.dispose]();
    }
    diffPanels.clear();
    return [...disposables];
  });
});
