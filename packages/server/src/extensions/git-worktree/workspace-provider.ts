import { $ } from "bun";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { adjectives, animals, uniqueNamesGenerator } from "unique-names-generator";
import type { ProjectContext, WorkspaceHandle, WorkspaceProvider } from "../../extension";
import { removeManagedGitWorktree, upsertManagedGitWorktree } from "./registry";

const MANAGED_WORKTREE_ROOT = path.join(homedir(), ".modern", "worktrees");
const MANAGED_BRANCH_PREFIX = "modern/ws/";
const MAX_CODENAME_ATTEMPTS = 50;

export function createGitWorktreeWorkspaceProvider(): WorkspaceProvider {
  return {
    id: "modern.git-worktree",
    title: "Git worktree",
    create: async (project) => createManagedWorkspace(project),
    teardown: async (workspace) => teardownManagedWorkspace(workspace),
  };
}

async function createManagedWorkspace(project: ProjectContext): Promise<WorkspaceHandle> {
  const projectCwd = path.resolve(project.cwd);
  const repositoryCwd = await resolveRepositoryAnchorCwd(projectCwd);
  const projectFolderName = sanitizeSegment(path.basename(repositoryCwd));
  const projectWorktreeRoot = path.join(MANAGED_WORKTREE_ROOT, projectFolderName);

  await mkdir(projectWorktreeRoot, { recursive: true });

  const startPoint = await resolveWorktreeStartPoint(repositoryCwd);
  const codename = await allocateCodename({
    repositoryCwd,
    projectWorktreeRoot,
  });

  const worktreeCwd = path.join(projectWorktreeRoot, codename);
  const branchName = `${MANAGED_BRANCH_PREFIX}${codename}`;

  await $`git -C ${repositoryCwd} worktree add -b ${branchName} ${worktreeCwd} ${startPoint}`;

  try {
    await runSetupScript(worktreeCwd);
    await upsertManagedGitWorktree({
      projectCwd: repositoryCwd,
      workspaceCwd: worktreeCwd,
      branchName,
    });
    return { cwd: worktreeCwd };
  } catch (error) {
    await safelyRemoveWorktree(repositoryCwd, worktreeCwd);
    await safelyDeleteBranch(repositoryCwd, branchName);

    throw new Error(`Failed to initialize managed workspace "${worktreeCwd}": ${toErrorMessage(error)}`);
  }
}

async function teardownManagedWorkspace(workspace: WorkspaceHandle): Promise<void> {
  const workspaceCwd = path.resolve(workspace.cwd);

  if (!isManagedWorkspacePath(workspaceCwd)) {
    return;
  }

  if (!(await pathExists(workspaceCwd))) {
    await removeManagedGitWorktree(workspaceCwd);
    return;
  }

  const repositoryCwd = await resolveRepositoryAnchorCwd(workspaceCwd);
  const branchName = await readCurrentBranch(workspaceCwd);

  await $`git -C ${repositoryCwd} worktree remove --force ${workspaceCwd}`;
  await $`git -C ${repositoryCwd} worktree prune`.nothrow();

  if (branchName?.startsWith(MANAGED_BRANCH_PREFIX)) {
    await $`git -C ${repositoryCwd} branch --delete --force ${branchName}`.nothrow();
  }

  await removeManagedGitWorktree(workspaceCwd);
}

async function allocateCodename(input: { repositoryCwd: string; projectWorktreeRoot: string }): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODENAME_ATTEMPTS; attempt += 1) {
    const codename = generateCodename();
    const branchName = `${MANAGED_BRANCH_PREFIX}${codename}`;
    const workspaceCwd = path.join(input.projectWorktreeRoot, codename);

    if (await pathExists(workspaceCwd)) {
      continue;
    }

    if (await branchExists(input.repositoryCwd, branchName)) {
      continue;
    }

    return codename;
  }

  throw new Error(
    `Failed to generate a unique workspace codename in "${input.projectWorktreeRoot}" after ${MAX_CODENAME_ATTEMPTS} attempts.`,
  );
}

function generateCodename(): string {
  const rawCodename = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: "-",
    length: 2,
    style: "lowerCase",
  });

  const normalized = rawCodename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "workspace";
}

async function resolveRepositoryAnchorCwd(cwd: string): Promise<string> {
  const commonDirRaw = (await $`git -C ${cwd} rev-parse --git-common-dir`.text()).trim();

  if (!commonDirRaw) {
    throw new Error(`Failed to resolve git common directory for "${cwd}".`);
  }

  const commonDir = path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(cwd, commonDirRaw);
  if (path.basename(commonDir) === ".git") {
    return path.dirname(commonDir);
  }

  return commonDir;
}

async function runSetupScript(worktreeCwd: string): Promise<void> {
  const setupScriptPath = path.join(worktreeCwd, ".modern", "setup.sh");

  if (!(await isFile(setupScriptPath))) {
    return;
  }

  await $`bash ${setupScriptPath}`.cwd(worktreeCwd);
}

async function resolveWorktreeStartPoint(repositoryCwd: string): Promise<string> {
  const hasOrigin = await fetchOrigin(repositoryCwd);
  if (!hasOrigin) {
    return "HEAD";
  }

  const originHead = await readOriginHeadRef(repositoryCwd);
  return originHead ?? "HEAD";
}

async function fetchOrigin(repositoryCwd: string): Promise<boolean> {
  const hasOrigin = await remoteExists(repositoryCwd, "origin");
  if (!hasOrigin) {
    return false;
  }

  try {
    await $`git -C ${repositoryCwd} fetch --prune origin`;
  } catch (error) {
    console.warn(`Failed to fetch origin for "${repositoryCwd}":`, error);
  }

  return true;
}

async function readOriginHeadRef(repositoryCwd: string): Promise<string | null> {
  try {
    const symbolicRef = (
      await $`git -C ${repositoryCwd} symbolic-ref --quiet --short refs/remotes/origin/HEAD`.text()
    ).trim();
    if (symbolicRef) {
      return symbolicRef;
    }
  } catch {
    // Fall back to a direct ref when origin/HEAD has no symbolic target.
  }

  try {
    await $`git -C ${repositoryCwd} rev-parse --verify --quiet origin/HEAD`;
    return "origin/HEAD";
  } catch {
    return null;
  }
}

async function remoteExists(repositoryCwd: string, remoteName: string): Promise<boolean> {
  const remotes = (await $`git -C ${repositoryCwd} remote`.text())
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);

  return remotes.includes(remoteName);
}

function sanitizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "project";
}

function isManagedWorkspacePath(workspaceCwd: string): boolean {
  const relativePath = path.relative(MANAGED_WORKTREE_ROOT, workspaceCwd);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function branchExists(repositoryCwd: string, branchName: string): Promise<boolean> {
  const output = (await $`git -C ${repositoryCwd} branch --list ${branchName}`.text()).trim();
  return output.length > 0;
}

async function readCurrentBranch(cwd: string): Promise<string | null> {
  const branchName = (await $`git -C ${cwd} branch --show-current`.text()).trim();
  return branchName || null;
}

async function safelyRemoveWorktree(repositoryCwd: string, worktreeCwd: string): Promise<void> {
  await $`git -C ${repositoryCwd} worktree remove --force ${worktreeCwd}`.nothrow();
  await $`git -C ${repositoryCwd} worktree prune`.nothrow();
}

async function safelyDeleteBranch(repositoryCwd: string, branchName: string): Promise<void> {
  if (!branchName.startsWith(MANAGED_BRANCH_PREFIX)) {
    return;
  }

  await $`git -C ${repositoryCwd} branch --delete --force ${branchName}`.nothrow();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    const file = await stat(targetPath);
    return file.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return String(error);
}
