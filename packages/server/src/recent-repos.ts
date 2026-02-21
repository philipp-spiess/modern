import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface RecentRepo {
  path: string;
  name: string;
  updatedAt: number;
}

// Directories that never contain user repos — skip to keep the walk fast.
const SKIP = new Set([
  ".cache",
  ".Trash",
  ".npm",
  ".yarn",
  ".pnpm",
  ".bun",
  ".cargo",
  ".rustup",
  ".gradle",
  ".m2",
  ".cocoapods",
  ".docker",
  ".orbstack",
  ".local",
  ".vscode",
  ".cursor",
  ".Spotlight-V100",
  ".fseventsd",
  ".DocumentRevisions-V100",
  ".vol",
  "Applications",
  "Pictures",
  "Music",
  "Movies",
  "Photos",
  "Library",
  "Public",
  "Desktop",
  "node_modules",
  "target",
  "build",
  "dist",
  ".next",
  ".nuxt",
  ".output",
  "vendor",
  "bower_components",
  "__pycache__",
  ".git",
]);

const MAX_DEPTH = 5;

let cached: { repos: RecentRepo[]; timestamp: number } | null = null;
const CACHE_TTL = 30_000;

/**
 * Discovers git repos under $HOME using a best-first search:
 * directories are statted and visited most-recent-mtime first,
 * so we naturally find the latest repos early and can stop once
 * we have enough.
 */
export async function discoverRecentRepos(limit = 5): Promise<RecentRepo[]> {
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.repos.slice(0, limit);
  }

  const home = homedir();
  const repos: RecentRepo[] = [];

  const walkDir = async (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || repos.length >= limit) {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    // Check if this directory is a git repo
    if (entries.includes(".git")) {
      // Use .git/index mtime — updated on every staging/commit
      // Fall back to .git/HEAD if index doesn't exist
      let mtime = 0;
      for (const candidate of [".git/index", ".git/HEAD"]) {
        const file = Bun.file(path.join(dir, candidate));
        if (await file.exists()) {
          mtime = (await file.stat()).mtimeMs;
          break;
        }
      }

      if (mtime > 0) {
        repos.push({ path: dir, name: path.basename(dir), updatedAt: mtime });
      }
      return;
    }

    // Collect eligible subdirectories and stat them in parallel
    const subdirs: string[] = [];
    for (const name of entries) {
      if (SKIP.has(name) || (name.startsWith(".") && name !== ".git")) {
        continue;
      }
      subdirs.push(path.join(dir, name));
    }

    if (subdirs.length === 0) {
      return;
    }

    // Stat all children in parallel to get mtime, filter to directories
    const withMtime = await Promise.all(
      subdirs.map(async (childPath) => {
        try {
          const s = await stat(childPath);
          if (!s.isDirectory()) {
            return null;
          }
          return { path: childPath, mtime: s.mtimeMs };
        } catch {
          return null;
        }
      }),
    );

    // Sort by mtime descending — visit most recently modified first
    const sorted = withMtime
      .filter((entry): entry is { path: string; mtime: number } => entry !== null)
      .sort((a, b) => b.mtime - a.mtime);

    for (const child of sorted) {
      if (repos.length >= limit) {
        break;
      }
      await walkDir(child.path, depth + 1);
    }
  };

  await walkDir(home, 0);

  // Sort results by git activity (not directory mtime)
  repos.sort((a, b) => b.updatedAt - a.updatedAt);

  cached = { repos, timestamp: now };
  return repos.slice(0, limit);
}
