import { os } from "@orpc/server";
import * as z from "zod";
import { listOpenWorkspaces } from "../../state";
import { listThreadsForWorkspace, type WorkspaceThreads } from "./threads";

export const listWorkspaceThreads = os
  .input(
    z
      .object({
        workspaces: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .optional(),
  )
  .handler(async ({ input }) => {
    const workspaces = dedupeWorkspaces(input?.workspaces);
    const targets = workspaces.length > 0 ? workspaces : listOpenWorkspaces();

    const entries = await Promise.all(
      targets.map(async (cwd) => {
        try {
          const threads = await listThreadsForWorkspace(cwd, input?.limit);
          return { cwd, threads } satisfies WorkspaceThreads;
        } catch (error) {
          console.error(`Failed to list pi threads for workspace "${cwd}":`, error);
          return { cwd, threads: [] } satisfies WorkspaceThreads;
        }
      }),
    );

    return { workspaces: entries };
  });

export const agentRouter = {
  threadsList: listWorkspaceThreads,
};

function dedupeWorkspaces(workspaces?: readonly string[]): string[] {
  if (!workspaces?.length) {
    return [];
  }

  return [...new Set(workspaces.filter(Boolean))];
}
