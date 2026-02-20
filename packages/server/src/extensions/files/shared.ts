import path from "node:path";
import { URI } from "vscode-uri";

export type LoadResult = {
  uri: string;
  mtime: number;
  serverVersion: number;
  languageId: string;
  content: string;
};

export async function loadFile(uri: string): Promise<LoadResult> {
  const file = Bun.file(URI.parse(uri).fsPath);
  const contentPromise = file.text();
  const stats = await file.stat();

  return {
    uri,
    mtime: stats.mtimeMs,
    serverVersion: stats.mtimeMs,
    languageId: detectLanguage(uri),
    content: await contentPromise,
  };
}

export async function saveFile(uri: string, content: string, mtime?: number) {
  return withWriteLock(uri, async () => {
    const previous = await statSafe(uri);
    if (previous && mtime && previous.mtimeMs > mtime + 1) {
      throw new Error("File has changed on disk. Please reload before saving.");
    }

    await Bun.write(URI.parse(uri).fsPath, content);
    const nextStats = await Bun.file(URI.parse(uri).fsPath).stat();
    return {
      uri,
      mtime: nextStats.mtimeMs,
    };
  });
}

function detectLanguage(uri: string): string {
  const ext = path.extname(uri).slice(1).toLowerCase();
  switch (ext) {
    case "tsx":
      return "typescriptreact";
    case "ts":
      return "typescript";
    case "jsx":
      return "javascriptreact";
    case "js":
      return "javascript";
    case "json":
      return "json";
    case "rs":
      return "rust";
    case "md":
      return "markdown";
    default:
      return ext || "plaintext";
  }
}

const writeLocks = new Map<string, Promise<void>>();
async function withWriteLock<T>(uri: string, fn: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(uri) ?? Promise.resolve();
  let result!: T;
  const next = previous
    .catch(() => {})
    .then(async () => {
      result = await fn();
    })
    .finally(() => {
      if (writeLocks.get(uri) === next) {
        writeLocks.delete(uri);
      }
    });

  writeLocks.set(uri, next);
  await next;
  return result;
}

function statSafe(uri: string) {
  const file = Bun.file(URI.parse(uri).fsPath);
  return file.stat().catch(() => null);
}
