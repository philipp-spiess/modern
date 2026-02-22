import { getActiveWorkspaceCwd } from "../state";
import { type QuickOpenHit, type WorkerResponse } from "./worker";

type PendingResolver =
  | {
      kind: "quickOpen";
      resolve: (value: QuickOpenHit[]) => void;
      reject: (reason: Error) => void;
    }
  | {
      kind: "warmup";
      resolve: () => void;
      reject: (reason: Error) => void;
    };

interface QuickOpenParams {
  query: string;
  limit?: number;
  cwd?: string;
}

class FileIndexService {
  // In compiled binaries, Bun strips the common `src/` prefix from entry points
  // and transpiles .ts → .js, so the worker ends up at /$bunfs/root/file-index/worker.js.
  // In dev (bun run), .ts works directly via the relative path.
  #worker = new Worker(
    import.meta.url.includes("/$bunfs/")
      ? new URL("./file-index/worker.js", import.meta.url).href
      : new URL("./worker.ts", import.meta.url).href,
    { type: "module" },
  );
  #requestId = 0;
  #pending = new Map<number, PendingResolver>();

  constructor() {
    this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      const pending = this.#pending.get(message.requestId);
      if (!pending) {
        return;
      }

      switch (message.type) {
        case "quickOpenResult": {
          if (pending.kind !== "quickOpen") {
            return;
          }
          this.#pending.delete(message.requestId);
          pending.resolve(message.hits);
          break;
        }
        case "warmupResult": {
          if (pending.kind !== "warmup") {
            return;
          }
          this.#pending.delete(message.requestId);
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve();
          }
          break;
        }
      }
    };

    this.#worker.onerror = (event) => {
      const detail =
        event instanceof ErrorEvent
          ? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`
          : String(event);
      console.error("[FileIndexWorker] onerror:", detail);
      this.#flushPending(new Error(detail));
    };

    this.#worker.onmessageerror = (event) => {
      console.error("[FileIndexWorker] onmessageerror:", event);
      const err = event instanceof Error ? event : new Error(String(event));
      this.#flushPending(err);
    };
  }

  async quickOpen({ query, limit = 50, cwd }: QuickOpenParams): Promise<QuickOpenHit[]> {
    if (!query.trim()) {
      return [];
    }

    const targetCwd = cwd ?? getActiveWorkspaceCwd();
    if (!targetCwd) {
      throw new Error("fileIndex.quickOpen requires a cwd when no workspace is open");
    }

    const requestId = ++this.#requestId;
    const normalizedLimit = Math.max(1, Math.min(limit, 200));

    const result = new Promise<QuickOpenHit[]>((resolve, reject) => {
      this.#pending.set(requestId, { kind: "quickOpen", resolve, reject });
    });

    this.#worker.postMessage({
      type: "quickOpen",
      cwd: targetCwd,
      query,
      limit: normalizedLimit,
      requestId,
    });
    return result;
  }

  prewarm(cwd?: string): Promise<void> {
    const targetCwd = cwd ?? getActiveWorkspaceCwd();
    if (!targetCwd) {
      return Promise.resolve();
    }

    const requestId = ++this.#requestId;
    const result = new Promise<void>((resolve, reject) => {
      this.#pending.set(requestId, { kind: "warmup", resolve, reject });
    });

    this.#worker.postMessage({
      type: "warmup",
      cwd: targetCwd,
      requestId,
    });

    return result;
  }

  #flushPending(error: Error) {
    for (const [requestId, pending] of this.#pending) {
      pending.reject(error);
      this.#pending.delete(requestId);
    }
  }
}

const service = new FileIndexService();

export const fileIndex = {
  quickOpen: (params: QuickOpenParams) => service.quickOpen(params),
  prewarm: (cwd?: string) => service.prewarm(cwd),
};

export type { QuickOpenHit } from "./worker";
