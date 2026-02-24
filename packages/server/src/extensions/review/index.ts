import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";

export const id = "modern.review";

export default createExtension(async () => {
  const cwd = modern.workspace.cwd;
  if (!cwd) throw new Error("Workspace cwd is not available.");

  const disposables: Disposable[] = [];
  type PanelHandle = ReturnType<typeof modern.window.createReactPanel>;
  let diffPanel: PanelHandle | undefined;

  const register = <T extends (...args: any[]) => unknown>(
    command: string,
    handler: T,
    options?: Parameters<typeof modern.commands.registerCommand>[2],
  ) => {
    disposables.push(modern.commands.registerCommand(command, handler, options));
  };

  const openDiff = (focusPath?: string) => {
    // Recreate to guarantee exactly one visible "Changes" tab.
    // If the user closed the previous panel tab, the stale handle cannot re-open itself.
    diffPanel?.[Symbol.dispose]();
    diffPanel = modern.window.createReactPanel("review.diff", "review/diff-view.tsx", "Changes");
    diffPanel.state = { focusPath };
    return { focusPath };
  };

  register("review.openDiff", (focusPath?: string) => openDiff(focusPath));

  register("review.showChanges", () => openDiff(), {
    title: "Show Changes",
  });

  return createDisposable(() => {
    diffPanel?.[Symbol.dispose]();
    diffPanel = undefined;
    return [...disposables];
  });
});
