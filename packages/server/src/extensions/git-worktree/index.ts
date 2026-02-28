import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";
import { createGitWorktreeWorkspaceProvider } from "./workspace-provider";

export const id = "modern.git-worktree";

export default createExtension(() => {
  const disposables: Disposable[] = [];

  disposables.push(modern.project.registerWorkspaceProvider(createGitWorktreeWorkspaceProvider()));

  return createDisposable(() => disposables);
});
