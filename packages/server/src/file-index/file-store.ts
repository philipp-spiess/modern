import { type FileEntry, type QuickOpenHit, normalizePath, quickOpenFromEntries, toEntry } from "./scoring";

export interface FileStoreDeps {
  collectPaths: (cwd: string) => Promise<string[]>;
  checkIgnore: (path: string) => Promise<boolean>;
}

export class FileStore {
  readonly cwd: string;
  entries: FileEntry[] = [];
  map = new Map<string, FileEntry>();
  #deps: FileStoreDeps;

  constructor(cwd: string, deps: FileStoreDeps) {
    this.cwd = cwd;
    this.#deps = deps;
  }

  async initialize(): Promise<void> {
    const paths = await this.#deps.collectPaths(this.cwd);
    this.entries = [];
    this.map.clear();
    for (const relPath of paths) {
      this.addDirect(relPath);
    }
  }

  /** Add from initial scan (already gitignore-filtered by rg). */
  addDirect(relPath: string): void {
    const normalized = normalizePath(relPath);
    if (!normalized || normalized === ".git" || normalized.startsWith(".git/") || this.map.has(normalized)) {
      return;
    }
    const entry = toEntry(normalized);
    this.map.set(normalized, entry);
    this.entries.push(entry);
  }

  /** Add from watcher — checks gitignore first. */
  async addChecked(relPath: string): Promise<void> {
    const normalized = normalizePath(relPath);
    if (!normalized || normalized === ".git" || normalized.startsWith(".git/") || this.map.has(normalized)) {
      return;
    }
    const ignored = await this.#deps.checkIgnore(normalized);
    if (ignored) {
      return;
    }
    const entry = toEntry(normalized);
    this.map.set(normalized, entry);
    this.entries.push(entry);
  }

  remove(relPath: string): void {
    const normalized = normalizePath(relPath);
    if (!normalized) return;

    const entry = this.map.get(normalized);
    if (entry) {
      this.map.delete(normalized);
      const pos = this.entries.indexOf(entry);
      if (pos !== -1) this.entries.splice(pos, 1);
      return;
    }

    this.removePrefix(normalized.endsWith("/") ? normalized : `${normalized}/`);
  }

  removePrefix(prefix: string): void {
    const normalizedPrefix = normalizePath(prefix);
    if (!normalizedPrefix) return;
    const matchPrefix = normalizedPrefix.endsWith("/") ? normalizedPrefix : `${normalizedPrefix}/`;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.path === normalizedPrefix || entry.path.startsWith(matchPrefix)) {
        this.map.delete(entry.path);
        this.entries.splice(i, 1);
      }
    }
  }

  query(queryStr: string, limit = 50): QuickOpenHit[] {
    return quickOpenFromEntries(this.entries, queryStr, limit);
  }
}
