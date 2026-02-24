import { computed, signal } from "@preact/signals-core";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
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

async function buildTrackedPatch(instance: NonNullable<typeof git.value>): Promise<string> {
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

      // Skip .git internal files to avoid noise, but watch .git/index for staging changes
      const filenameStr = filename.toString();
      if (filenameStr.startsWith(".git/") && !filenameStr.includes("index")) {
        return;
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
