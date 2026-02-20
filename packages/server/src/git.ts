import { computed, signal } from "@preact/signals-core";
import { watch, type FSWatcher } from "node:fs";
import simpleGit, { type StatusResult } from "simple-git";
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
