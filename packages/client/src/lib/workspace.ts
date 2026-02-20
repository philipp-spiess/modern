import { queryClient } from "./query-client";
import { client, pickDirectory } from "./rpc";

type WorkspaceState = Awaited<ReturnType<typeof client.workspace.cwd>>;

function syncWorkspaceState(workspaceState: WorkspaceState): void {
  queryClient.setQueryData(["workspace", "cwd"], workspaceState);
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
    console.error("Failed to open workspace:", error);
  }
}

export async function activateWorkspace(cwd: string) {
  try {
    const workspaceState = await client.workspace.activate({ cwd });
    syncWorkspaceState(workspaceState);
  } catch (error) {
    console.error("Failed to activate workspace:", error);
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
