import { queryClient } from "./query-client";
import { client, pickDirectory } from "./rpc";
import { showToast } from "./toast";

type WorkspaceState = Awaited<ReturnType<typeof client.workspace.cwd>>;

function syncWorkspaceState(workspaceState: WorkspaceState): void {
  queryClient.setQueryData(["workspace", "cwd"], workspaceState);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const maybeError = error as {
      readonly message?: unknown;
      readonly data?: unknown;
      readonly cause?: unknown;
    };

    if (typeof maybeError.message === "string" && maybeError.message.trim()) {
      return maybeError.message;
    }

    if (typeof maybeError.data === "object" && maybeError.data !== null) {
      const data = maybeError.data as { readonly message?: unknown };
      if (typeof data.message === "string" && data.message.trim()) {
        return data.message;
      }
    }

    if (typeof maybeError.cause === "object" && maybeError.cause !== null) {
      const cause = maybeError.cause as { readonly message?: unknown };
      if (typeof cause.message === "string" && cause.message.trim()) {
        return cause.message;
      }
    }
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "An unexpected error occurred.";
}

function getWorkspaceOpenErrorDescription(error: unknown): string {
  const message = getErrorMessage(error);
  if (/not a git repository|\.git is missing/i.test(message)) {
    return "This folder is not a Git repository. Run git init or choose a different folder.";
  }

  return "Could not add this workspace. Please try again.";
}

export async function openWorkspace(cwd?: string) {
  const selectedPath = cwd ?? (await pickDirectory());
  if (!selectedPath) {
    return;
  }

  try {
    const workspaceState = await client.workspace.open({ cwd: selectedPath });
    syncWorkspaceState(workspaceState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not add workspace",
      description: getWorkspaceOpenErrorDescription(error),
    });
    console.error("Failed to open workspace:", error);
  }
}

export async function activateWorkspace(cwd: string) {
  try {
    const workspaceState = await client.workspace.activate({ cwd });
    syncWorkspaceState(workspaceState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not switch workspace",
      description: getWorkspaceOpenErrorDescription(error),
    });
    console.error("Failed to activate workspace:", error);
  }
}

export async function openWorkspaceWithThread(cwd: string, threadPath: string, title?: string) {
  try {
    const workspaceState = await client.workspace.openWithThread({
      cwd,
      threadPath,
      title,
    });
    syncWorkspaceState(workspaceState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not open workspace",
      description: getWorkspaceOpenErrorDescription(error),
    });
    console.error("Failed to open workspace thread:", error);
  }
}

export async function openWorkspaceWithNewThread(cwd: string, title = "New Thread") {
  try {
    const workspaceState = await client.workspace.openNewThread({
      cwd,
      title,
    });
    syncWorkspaceState(workspaceState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not open workspace",
      description: getWorkspaceOpenErrorDescription(error),
    });
    console.error("Failed to open new workspace thread:", error);
  }
}

export async function setWorkspaceExpanded(cwd: string, expanded: boolean) {
  try {
    const workspaceState = await client.workspace.setExpanded({ cwd, expanded });
    syncWorkspaceState(workspaceState);
  } catch (error) {
    console.error("Failed to persist workspace expansion:", error);
  }
}

export async function removeWorkspaceWithThreads(cwd: string) {
  try {
    const workspaceState = await client.workspace.remove({ cwd });
    syncWorkspaceState(workspaceState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not remove workspace",
      description: "Could not remove this workspace. Please try again.",
    });
    console.error("Failed to remove workspace:", error);
  }
}
