import { computed, signal } from "@preact/signals-core";
import { watch, type FSWatcher } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import simpleGit, { type FileStatusResult, type StatusResult } from "simple-git";
import { getActiveWorkspaceCwd } from "./state";
import { createDisposable } from "./utils/disposable";

const git = computed(() => {
  const cwd = getActiveWorkspaceCwd();
  return cwd ? simpleGit(cwd) : null;
});

// Signal for git status updates - holds the latest status and a revision counter
export const gitStatusSignal = signal<{ status: StatusResult | null; rev: number }>({
  status: null,
  rev: 0,
});

type GitInstance = NonNullable<typeof git.value>;

interface ChangeSummary {
  insertions: number;
  deletions: number;
}

const EMPTY_CHANGE_SUMMARY: ChangeSummary = {
  insertions: 0,
  deletions: 0,
};

export interface GitSummarySnapshot {
  current: string | null;
  filesChanged: number;
  insertions: number;
  deletions: number;
  generatedAt: number;
}

export type WorkingChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface WorkingChangeFile {
  path: string;
  kind: WorkingChangeKind;
}

export interface WorkingChangesSnapshot {
  patch: string;
  files: WorkingChangeFile[];
  generatedAt: number;
}

const DEBOUNCE_MS = 150;

async function refreshGitStatus() {
  try {
    const instance = git.value;
    if (!instance) {
      gitStatusSignal.value = { status: null, rev: gitStatusSignal.value.rev + 1 };
      return;
    }

    const status = await instance.status();
    gitStatusSignal.value = { status, rev: gitStatusSignal.value.rev + 1 };
  } catch (error) {
    console.error("Failed to refresh git status:", error);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void refreshGitStatus();
  }, DEBOUNCE_MS);
}

export async function stage(path: string) {
  await git.value?.add(path);
  scheduleRefresh();
}

export async function unstage(path: string) {
  await git.value?.reset(["--", path]);
  scheduleRefresh();
}

export async function restore(filePath: string) {
  const instance = git.value;
  const cwd = getActiveWorkspaceCwd();
  if (!instance || !cwd) {
    return;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");

  try {
    const status = await instance.status(["--", normalizedPath]);
    const isUntracked =
      status.not_added.includes(normalizedPath) ||
      status.files.some((file) => file.path === normalizedPath && `${file.index}${file.working_dir}`.includes("?"));

    if (isUntracked) {
      await rm(path.join(cwd, normalizedPath), { recursive: true, force: true });
      return;
    }

    try {
      await instance.raw(["restore", "--source=HEAD", "--staged", "--worktree", "--", normalizedPath]);
    } catch (error) {
      const hasHead = await instance
        .raw(["rev-parse", "--verify", "HEAD"])
        .then(() => true)
        .catch(() => false);

      if (hasHead) {
        throw error;
      }

      // Repositories without HEAD cannot restore against a base commit.
      await instance.raw(["rm", "--cached", "--ignore-unmatch", "--", normalizedPath]).catch(() => {});
      await instance.raw(["checkout", "--", normalizedPath]).catch(() => {});
      await rm(path.join(cwd, normalizedPath), { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    scheduleRefresh();
  }
}

export async function showHead(path: string): Promise<string | null> {
  try {
    const instance = git.value;
    if (!instance) return null;
    const content = await instance.show([`HEAD:${path}`]);
    return content;
  } catch {
    return null;
  }
}

export async function showStaged(path: string): Promise<string | null> {
  try {
    const instance = git.value;
    if (!instance) return null;
    const content = await instance.show([`:${path}`]);
    return content;
  } catch {
    return null;
  }
}

export async function showWorktree(path: string): Promise<string | null> {
  try {
    const cwd = getActiveWorkspaceCwd();
    if (!cwd) return null;
    const fullPath = `${cwd}/${path}`;
    const file = Bun.file(fullPath);
    if (!(await file.exists())) return null;
    return await file.text();
  } catch {
    return null;
  }
}

export async function buildGitSummarySnapshot(input?: { cwd?: string }): Promise<GitSummarySnapshot> {
  const cwd = input?.cwd ?? getActiveWorkspaceCwd();
  const instance = cwd ? simpleGit(cwd) : null;
  if (!instance || !cwd) {
    return {
      current: null,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      generatedAt: Date.now(),
    };
  }

  const status = await instance.status();
  const trackedSummary = await buildTrackedSummary(instance);
  const untrackedSummary = await buildUntrackedSummary(cwd, status.not_added);

  return {
    current: status.current || null,
    filesChanged: collectWorkingChangeFiles(status).length,
    insertions: trackedSummary.insertions + untrackedSummary.insertions,
    deletions: trackedSummary.deletions + untrackedSummary.deletions,
    generatedAt: Date.now(),
  };
}

export async function buildWorkingChangesSnapshot(input?: { cwd?: string }): Promise<WorkingChangesSnapshot> {
  const cwd = input?.cwd ?? getActiveWorkspaceCwd();
  const instance = cwd ? simpleGit(cwd) : null;
  if (!instance || !cwd) {
    return {
      patch: "",
      files: [],
      generatedAt: Date.now(),
    };
  }

  const status = await instance.status();
  const trackedPatch = await buildTrackedPatch(instance);
  const untrackedPatch = await buildUntrackedPatch(cwd, status.not_added);
  const patch = joinPatches([trackedPatch, untrackedPatch]);

  return {
    patch,
    files: collectWorkingChangeFiles(status),
    generatedAt: Date.now(),
  };
}

async function buildTrackedSummary(instance: GitInstance): Promise<ChangeSummary> {
  const summaryFromHead = await readDiffSummary(instance, ["HEAD", "--"]);
  if (summaryFromHead) {
    return summaryFromHead;
  }

  // HEAD may not exist yet in freshly initialized repositories.
  const stagedSummary = (await readDiffSummary(instance, ["--cached", "--"])) ?? EMPTY_CHANGE_SUMMARY;
  const unstagedSummary = (await readDiffSummary(instance, ["--"])) ?? EMPTY_CHANGE_SUMMARY;

  return {
    insertions: stagedSummary.insertions + unstagedSummary.insertions,
    deletions: stagedSummary.deletions + unstagedSummary.deletions,
  };
}

async function readDiffSummary(instance: GitInstance, args: string[]): Promise<ChangeSummary | null> {
  try {
    const summary = await instance.diffSummary(args);
    return {
      insertions: summary.insertions,
      deletions: summary.deletions,
    };
  } catch {
    return null;
  }
}

async function buildUntrackedSummary(cwd: string, untrackedPaths: readonly string[]): Promise<ChangeSummary> {
  if (untrackedPaths.length === 0) {
    return EMPTY_CHANGE_SUMMARY;
  }

  let insertions = 0;
  const uniquePaths = [...new Set(untrackedPaths)].sort((left, right) => left.localeCompare(right));

  for (const relativePath of uniquePaths) {
    const fullPath = path.join(cwd, relativePath);
    const stats = await stat(fullPath).catch(() => null);
    if (!stats || !stats.isFile()) {
      continue;
    }

    try {
      const content = await Bun.file(fullPath).text();
      insertions += countTextLines(content);
    } catch {
      // Skip unreadable files (for example binary blobs that cannot be decoded as text).
    }
  }

  return {
    insertions,
    deletions: 0,
  };
}

function countTextLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const lineCount = content.split("\n").length;
  return content.endsWith("\n") ? lineCount - 1 : lineCount;
}

async function buildTrackedPatch(instance: GitInstance): Promise<string> {
  try {
    return await instance.diff(["--no-color", "--find-renames", "HEAD", "--"]);
  } catch {
    // HEAD may not exist yet in freshly initialized repositories.
    const staged = await instance.diff(["--no-color", "--find-renames", "--cached", "--"]);
    const unstaged = await instance.diff(["--no-color", "--find-renames", "--"]);
    return joinPatches([staged, unstaged]);
  }
}

function collectWorkingChangeFiles(status: StatusResult): WorkingChangeFile[] {
  const byPath = new Map<string, WorkingChangeKind>();

  for (const file of status.files) {
    const kind = getFileKind(file);
    if (!kind) continue;
    byPath.set(file.path, kind);
  }

  for (const untrackedPath of status.not_added) {
    if (!byPath.has(untrackedPath)) {
      byPath.set(untrackedPath, "untracked");
    }
  }

  return [...byPath.entries()]
    .map(([path, kind]) => ({ path, kind }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function getFileKind(file: FileStatusResult): WorkingChangeKind | null {
  const index = file.index.trim();
  const working = file.working_dir.trim();
  const combined = `${index}${working}`;

  if (!combined) {
    return null;
  }

  if (file.from || combined.includes("R")) {
    return "renamed";
  }

  if (combined.includes("?")) {
    return "untracked";
  }

  if (combined.includes("D")) {
    return "deleted";
  }

  if (combined.includes("A")) {
    return "added";
  }

  return "modified";
}

async function buildUntrackedPatch(cwd: string, untrackedPaths: readonly string[]): Promise<string> {
  if (untrackedPaths.length === 0) {
    return "";
  }

  const uniquePaths = [...new Set(untrackedPaths)].sort((left, right) => left.localeCompare(right));
  const patches: string[] = [];

  for (const relativePath of uniquePaths) {
    const fullPath = path.join(cwd, relativePath);
    const stats = await stat(fullPath).catch(() => null);
    if (!stats) {
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    try {
      const content = await Bun.file(fullPath).text();
      patches.push(buildUntrackedFilePatch(relativePath, content));
    } catch {
      // Skip unreadable files (for example binary blobs that cannot be decoded as text).
    }
  }

  return joinPatches(patches);
}

function buildUntrackedFilePatch(filePath: string, content: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.length === 0 ? [] : content.split("\n");

  if (hasTrailingNewline) {
    lines.pop();
  }

  const patchLines = [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${normalizedPath}`,
  ];

  if (lines.length > 0) {
    patchLines.push(`@@ -0,0 +1,${lines.length} @@`);
    for (const line of lines) {
      patchLines.push(`+${line}`);
    }
  }

  return `${patchLines.join("\n")}\n`;
}

function joinPatches(parts: readonly string[]): string {
  const normalized = parts.map((part) => part.trim()).filter((part) => part.length > 0);
  if (normalized.length === 0) {
    return "";
  }
  return `${normalized.join("\n\n")}\n`;
}

export function startGitWatcher(cwd: string): Disposable {
  // Do an initial refresh
  void refreshGitStatus();

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(cwd, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;

      // Skip .git internals except .git/index. Ignore .git/index.lock to avoid refresh loops.
      const filenameStr = filename.toString().replace(/\\/g, "/");
      if (filenameStr.startsWith(".git/")) {
        if (filenameStr.endsWith("/index.lock")) {
          return;
        }

        if (filenameStr !== ".git/index") {
          return;
        }
      }

      scheduleRefresh();
    });
  } catch (error) {
    console.error("Failed to start git watcher:", error);
    return createDisposable(() => {});
  }

  return createDisposable(() => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  });
}
