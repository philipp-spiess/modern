import path from "node:path";
import { getGlobal, setGlobal } from "../../storage";

const GIT_WORKTREE_SCOPE = "ext:modern.git-worktree";
const MANAGED_WORKSPACES_KEY = "managed-workspaces";

export interface ManagedGitWorktreeRecord {
  projectCwd: string;
  workspaceCwd: string;
  branchName: string;
  createdAt: number;
  updatedAt: number;
}

export function listManagedGitWorktrees(): ManagedGitWorktreeRecord[] {
  const stored = getGlobal<unknown>(GIT_WORKTREE_SCOPE, MANAGED_WORKSPACES_KEY, []);
  if (!Array.isArray(stored)) {
    return [];
  }

  const recordsByWorkspace = new Map<string, ManagedGitWorktreeRecord>();

  for (const entry of stored) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Partial<ManagedGitWorktreeRecord>;
    if (typeof candidate.projectCwd !== "string" || typeof candidate.workspaceCwd !== "string") {
      continue;
    }

    const projectCwd = path.resolve(candidate.projectCwd);
    const workspaceCwd = path.resolve(candidate.workspaceCwd);
    const branchName = typeof candidate.branchName === "string" ? candidate.branchName : "";
    const createdAt = Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : Date.now();
    const updatedAt = Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : createdAt;

    recordsByWorkspace.set(workspaceCwd, {
      projectCwd,
      workspaceCwd,
      branchName,
      createdAt,
      updatedAt,
    });
  }

  return [...recordsByWorkspace.values()].sort((left, right) => left.workspaceCwd.localeCompare(right.workspaceCwd));
}

export function getManagedGitWorktree(workspaceCwd: string): ManagedGitWorktreeRecord | null {
  const resolvedWorkspaceCwd = path.resolve(workspaceCwd);
  return listManagedGitWorktrees().find((entry) => entry.workspaceCwd === resolvedWorkspaceCwd) ?? null;
}

export async function upsertManagedGitWorktree(input: {
  projectCwd: string;
  workspaceCwd: string;
  branchName: string;
}): Promise<void> {
  const projectCwd = path.resolve(input.projectCwd);
  const workspaceCwd = path.resolve(input.workspaceCwd);
  const branchName = input.branchName.trim();
  const now = Date.now();

  const existing = listManagedGitWorktrees();
  const next = existing.filter((entry) => entry.workspaceCwd !== workspaceCwd);

  const previous = existing.find((entry) => entry.workspaceCwd === workspaceCwd);

  next.push({
    projectCwd,
    workspaceCwd,
    branchName,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  });

  await setGlobal(GIT_WORKTREE_SCOPE, MANAGED_WORKSPACES_KEY, next);
}

export async function removeManagedGitWorktree(workspaceCwd: string): Promise<void> {
  const resolvedWorkspaceCwd = path.resolve(workspaceCwd);
  const existing = listManagedGitWorktrees();
  const next = existing.filter((entry) => entry.workspaceCwd !== resolvedWorkspaceCwd);

  if (next.length === existing.length) {
    return;
  }

  await setGlobal(GIT_WORKTREE_SCOPE, MANAGED_WORKSPACES_KEY, next);
}
