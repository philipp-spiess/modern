import { queryClient } from "./query-client";
import { client, pickDirectory } from "./rpc";
import { showToast } from "./toast";

type ProjectState = Awaited<ReturnType<typeof client.project.current>>;

function syncProjectState(projectState: ProjectState): void {
  queryClient.setQueryData(["project", "current"], projectState);
  // Keep legacy cache key in sync for transitional consumers.
  queryClient.setQueryData(["workspace", "cwd"], {
    cwd: projectState.cwd,
    workspaces: projectState.projects,
    expandedByWorkspace: projectState.expandedByProject,
    activeThread: projectState.activeThread,
  });
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

function getProjectOpenErrorDescription(error: unknown): string {
  const message = getErrorMessage(error);
  if (/not a git repository|\.git is missing/i.test(message)) {
    return "This folder is not a Git repository. Run git init or choose a different folder.";
  }

  return "Could not add this project. Please try again.";
}

export async function openProject(cwd?: string) {
  const selectedPath = cwd ?? (await pickDirectory());
  if (!selectedPath) {
    return;
  }

  try {
    const projectState = await client.project.open({ cwd: selectedPath });
    syncProjectState(projectState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not add project",
      description: getProjectOpenErrorDescription(error),
    });
    console.error("Failed to open project:", error);
  }
}

export async function activateProject(cwd: string) {
  try {
    const projectState = await client.project.activate({ cwd });
    syncProjectState(projectState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not switch project",
      description: getProjectOpenErrorDescription(error),
    });
    console.error("Failed to activate project:", error);
  }
}

export async function openProjectWithThread(cwd: string, threadPath: string, title?: string) {
  try {
    const projectState = await client.project.openWithThread({
      cwd,
      threadPath,
      title,
    });
    syncProjectState(projectState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not open project",
      description: getProjectOpenErrorDescription(error),
    });
    console.error("Failed to open project thread:", error);
  }
}

export async function openProjectWithNewThread(cwd: string, title = "New Thread") {
  try {
    const projectState = await client.project.openNewThread({
      cwd,
      title,
    });
    syncProjectState(projectState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not open project",
      description: getProjectOpenErrorDescription(error),
    });
    console.error("Failed to open new project thread:", error);
  }
}

export async function setProjectExpanded(cwd: string, expanded: boolean) {
  try {
    const projectState = await client.project.setExpanded({ cwd, expanded });
    syncProjectState(projectState);
  } catch (error) {
    console.error("Failed to persist project expansion:", error);
  }
}

export async function removeProject(cwd: string) {
  try {
    const projectState = await client.project.remove({ cwd });
    syncProjectState(projectState);
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not remove project",
      description: "Could not remove this project. Please try again.",
    });
    console.error("Failed to remove project:", error);
  }
}

export async function archiveThread(projectCwd: string, threadPath: string): Promise<string | null> {
  try {
    const archived = await client.agent.threadArchive({ projectCwd, threadPath });
    await queryClient.invalidateQueries({ queryKey: ["agent", "threadsList"] });
    return archived.threadPath;
  } catch (error) {
    showToast({
      variant: "error",
      title: "Could not archive thread",
      description: getErrorMessage(error),
    });
    console.error("Failed to archive thread:", error);
    return null;
  }
}
