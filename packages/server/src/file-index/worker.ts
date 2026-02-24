import { rgPath as defaultRgPath } from "@vscode/ripgrep";

const rgPath = process.env.RG_PATH || defaultRgPath;
import { watch, type FSWatcher } from "fs";
import { stat } from "fs/promises";
import path from "path";
import simpleGit from "simple-git";

type QuickOpenMessage = {
  type: "quickOpen";
  cwd: string;
  query: string;
  limit: number;
  requestId: number;
};

type WarmupMessage = {
  type: "warmup";
  cwd: string;
  requestId: number;
};

type WorkerMessage = QuickOpenMessage | WarmupMessage;

export interface QuickOpenHit {
  path: string;
  score: number;
  basenameHighlights: Array<[number, number]>;
  pathHighlights: Array<[number, number]>;
}

export type WorkerResponse =
  | {
      type: "quickOpenResult";
      requestId: number;
      hits: QuickOpenHit[];
    }
  | {
      type: "warmupResult";
      requestId: number;
      error?: string;
    };

interface FileEntry {
  path: string;
  lowerPath: string;
  basename: string;
  lowerBasename: string;
  depth: number;
}

interface IndexData {
  cwd: string;
  entries: FileEntry[];
  map: Map<string, FileEntry>;
  initializing?: Promise<void>;
  watcher?: FSWatcher;
  git: ReturnType<typeof simpleGit>;
}

const indexes = new Map<string, IndexData>();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  void handleMessage(event.data);
};

async function handleMessage(message: WorkerMessage) {
  switch (message.type) {
    case "quickOpen": {
      try {
        const hits = await handleQuickOpen(message);
        postMessage({
          type: "quickOpenResult",
          requestId: message.requestId,
          hits,
        } satisfies WorkerResponse);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        postMessage({
          type: "quickOpenResult",
          requestId: message.requestId,
          hits: [],
        } satisfies WorkerResponse);
        console.error(`quickOpen failed for ${message.cwd}: ${err.message}`);
      }
      break;
    }
    case "warmup": {
      try {
        await ensureIndex(message.cwd);
        postMessage({
          type: "warmupResult",
          requestId: message.requestId,
        } satisfies WorkerResponse);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        postMessage({
          type: "warmupResult",
          requestId: message.requestId,
          error: err.message,
        } satisfies WorkerResponse);
        console.error(`warmup failed for ${message.cwd}: ${err.message}`);
      }
      break;
    }
  }
}

async function handleQuickOpen({ cwd, query, limit }: QuickOpenMessage): Promise<QuickOpenHit[]> {
  const index = await ensureIndex(cwd);
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const matches: QuickOpenHit[] = [];
  for (const entry of index.entries) {
    const match = matchEntry(entry, needle);
    if (!match) {
      continue;
    }

    matches.push(match);
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.path.localeCompare(b.path);
  });

  return matches.slice(0, limit);
}

async function ensureIndex(cwd: string): Promise<IndexData> {
  let index = indexes.get(cwd);

  if (!index) {
    index = {
      cwd,
      entries: [],
      map: new Map(),
      git: simpleGit(cwd),
    };
    indexes.set(cwd, index);
  }

  if (!index.initializing) {
    index.initializing = initializeIndex(index).catch((error) => {
      indexes.delete(cwd);
      throw error;
    });
  }

  await index.initializing;
  return index;
}

async function initializeIndex(index: IndexData) {
  const paths = await collectPaths(index.cwd);
  index.entries = [];
  index.map.clear();

  for (const relPath of paths) {
    addEntryDirect(index, relPath);
  }

  if (index.watcher) {
    index.watcher.close();
  }

  index.watcher = watch(index.cwd, { recursive: true }, (eventType, filename) => {
    if (!filename) {
      return;
    }

    const relPath = normalizePath(filename);
    if (!relPath) {
      return;
    }

    void handleWatchEvent(index, eventType, relPath);
  });
}

async function handleWatchEvent(index: IndexData, eventType: string, relPath: string) {
  const absolute = path.join(index.cwd, relPath);

  if (eventType === "rename") {
    try {
      const stats = await stat(absolute);
      if (stats.isFile()) {
        await addEntry(index, relPath);
      } else if (stats.isDirectory()) {
        // Directory renamed/created - nothing to do until file events arrive.
        removeEntriesWithPrefix(index, relPath + "/");
      }
    } catch {
      removeEntry(index, relPath);
    }
    return;
  }

  if (eventType === "change") {
    try {
      const stats = await stat(absolute);
      if (stats.isFile()) {
        await addEntry(index, relPath);
      }
    } catch {
      removeEntry(index, relPath);
    }
  }
}

async function collectPaths(cwd: string): Promise<string[]> {
  const cmd = Bun.spawn({
    cmd: [rgPath, "--files", "--null"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const textStream = cmd.stdout?.pipeThrough(new TextDecoderStream());
  const paths: string[] = [];

  if (textStream) {
    let buffer = "";
    for await (const chunk of textStream as any) {
      buffer += chunk;
      let separatorIndex = buffer.indexOf("\0");
      while (separatorIndex !== -1) {
        const raw = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 1);
        const normalized = normalizePath(raw);
        if (normalized) {
          paths.push(normalized);
        }
        separatorIndex = buffer.indexOf("\0");
      }
    }

    if (buffer.length > 0) {
      const normalized = normalizePath(buffer);
      if (normalized) {
        paths.push(normalized);
      }
    }
  }

  const exitCode = await cmd.exited;
  const stderr = cmd.stderr ? await new Response(cmd.stderr).text() : "";

  if (exitCode === 1 && stderr.trim().length === 0) {
    // ripgrep returns 1 when no files are discovered.
    return paths;
  }

  if (exitCode !== 0) {
    throw new Error(`ripgrep exited with code ${exitCode}: ${stderr}`);
  }

  return paths;
}

/** Add a file from the initial `rg --files` scan (already gitignore-filtered). */
function addEntryDirect(index: IndexData, relPath: string) {
  const normalized = normalizePath(relPath);
  if (!normalized) {
    return;
  }

  if (normalized === ".git" || normalized.startsWith(".git/")) {
    return;
  }

  if (index.map.has(normalized)) {
    return;
  }

  const entry = toEntry(normalized);
  index.map.set(normalized, entry);
  index.entries.push(entry);
}

/** Add a file discovered by the fs watcher — checks gitignore first. */
async function addEntry(index: IndexData, relPath: string) {
  const normalized = normalizePath(relPath);
  if (!normalized) {
    return;
  }

  if (normalized === ".git" || normalized.startsWith(".git/")) {
    return;
  }

  if (index.map.has(normalized)) {
    return;
  }

  try {
    const ignored = await index.git.checkIgnore(normalized);
    if (ignored.length > 0) {
      return;
    }
  } catch {
    // If git check fails (e.g., not a git repo), continue adding the file
  }

  const entry = toEntry(normalized);
  index.map.set(normalized, entry);
  index.entries.push(entry);
}

function removeEntry(index: IndexData, relPath: string) {
  const normalized = normalizePath(relPath);
  if (!normalized) {
    return;
  }

  const entry = index.map.get(normalized);
  if (entry) {
    index.map.delete(normalized);
    const position = index.entries.indexOf(entry);
    if (position !== -1) {
      index.entries.splice(position, 1);
    }
    return;
  }

  removeEntriesWithPrefix(index, normalized.endsWith("/") ? normalized : `${normalized}/`);
}

function removeEntriesWithPrefix(index: IndexData, prefix: string) {
  const normalizedPrefix = normalizePath(prefix);
  if (!normalizedPrefix) {
    return;
  }

  const matchPrefix = normalizedPrefix.endsWith("/") ? normalizedPrefix : `${normalizedPrefix}/`;

  for (let i = index.entries.length - 1; i >= 0; i--) {
    const entry = index.entries[i];
    if (entry.path === normalizedPrefix || entry.path.startsWith(matchPrefix)) {
      index.map.delete(entry.path);
      index.entries.splice(i, 1);
    }
  }
}

function toEntry(relPath: string): FileEntry {
  const basename = relPath.split("/").pop() ?? relPath;
  return {
    path: relPath,
    lowerPath: relPath.toLowerCase(),
    basename,
    lowerBasename: basename.toLowerCase(),
    depth: Math.max(0, relPath.split("/").length - 1),
  };
}

function matchEntry(entry: FileEntry, needle: string): QuickOpenHit | null {
  const basenameMatch = fuzzyMatch(needle, entry.lowerBasename, entry.basename);
  if (basenameMatch) {
    // Boost basename matches to ensure files named "app" rank above "application"
    // We add a large bonus (200) but subtract depth (1 point per level)
    // This ensures depth is only a tie-breaker
    // Also subtract length difference to prefer shorter exact matches
    // e.g. "app" matches "app.tsx" (diff 4) better than "application.tsx" (diff 12)
    const lengthPenalty = entry.basename.length - needle.length;
    const score = basenameMatch.score + 200 - entry.depth - lengthPenalty / 2;
    return {
      path: entry.path,
      score,
      basenameHighlights: toRanges(basenameMatch.positions),
      pathHighlights: shiftRanges(toRanges(basenameMatch.positions), entry.path.length - entry.basename.length),
    };
  }

  const pathMatch = fuzzyMatch(needle, entry.lowerPath, entry.path);
  if (!pathMatch) {
    return null;
  }

  const basenameStart = entry.path.length - entry.basename.length;
  const basenamePositions = pathMatch.positions
    .filter((position) => position >= basenameStart)
    .map((position) => position - basenameStart);

  const basenameHighlights = basenamePositions.length > 0 ? toRanges(basenamePositions) : [];

  const score = pathMatch.score - entry.depth;

  return {
    path: entry.path,
    score,
    basenameHighlights,
    pathHighlights: toRanges(pathMatch.positions),
  };
}

interface FuzzyMatch {
  score: number;
  positions: number[];
}

function fuzzyMatch(needle: string, lowerHaystack: string, originalHaystack: string): FuzzyMatch | null {
  const n = needle.length;
  const m = lowerHaystack.length;

  if (n === 0 || n > m) {
    return null;
  }

  // 1. Fast check: ensure all characters exist in order
  let hIdx = 0;
  for (let i = 0; i < n; i++) {
    const code = needle.charCodeAt(i);
    let found = false;
    while (hIdx < m) {
      if (lowerHaystack.charCodeAt(hIdx++) === code) {
        found = true;
        break;
      }
    }
    if (!found) {
      return null;
    }
  }

  // 2. DP Scoring
  // P[i * m + j] stores the previous index for backtracking
  const P = new Int32Array(n * m);

  // Current row scores (for needle[i])
  const currM = new Int32Array(m).fill(-100000);
  // Previous row scores (for needle[i-1])
  const prevM = new Int32Array(m).fill(-100000);

  // Constants
  const MATCH_BONUS = 10;
  const CONSECUTIVE_BONUS = 35;
  const START_BONUS = 50; // Start of string
  const WORD_START_BONUS = 30; // Start of word or CamelCase
  const GAP_PENALTY = -2;

  const isWordStart = (idx: number) => {
    if (idx === 0) return true;
    const prev = originalHaystack.charCodeAt(idx - 1);
    const curr = originalHaystack.charCodeAt(idx);

    // Separators: / - _ . space " ' :
    if (
      prev === 47 ||
      prev === 45 ||
      prev === 95 ||
      prev === 46 ||
      prev === 32 ||
      prev === 34 ||
      prev === 39 ||
      prev === 58
    ) {
      return true;
    }
    // CamelCase: prev is lower (97-122), curr is upper (65-90)
    if (prev >= 97 && prev <= 122 && curr >= 65 && curr <= 90) {
      return true;
    }
    return false;
  };

  // Initialize first row (needle[0])
  const firstCode = needle.charCodeAt(0);
  for (let j = 0; j < m; j++) {
    if (lowerHaystack.charCodeAt(j) === firstCode) {
      let score = MATCH_BONUS;
      if (j === 0) score += START_BONUS;
      else if (isWordStart(j)) score += WORD_START_BONUS;

      // Apply gap penalty from start
      score += j * GAP_PENALTY;

      currM[j] = score;
    }
  }

  // DP for remaining characters
  for (let i = 1; i < n; i++) {
    const charCode = needle.charCodeAt(i);

    // Swap arrays: prevM becomes old currM, currM resets
    prevM.set(currM);
    currM.fill(-100000);

    // Optimization: track the best gap score for O(1) updates
    // runningMax tracks: max(prevM[k] - k * GAP_PENALTY) for k < j-1
    let runningMax = -100000;

    for (let j = i; j < m; j++) {
      // Update gap pool with (j-2) if available
      if (j >= 2) {
        const prevK = j - 2;
        // We only care about valid scores
        if (prevM[prevK] > -100000) {
          const val = prevM[prevK] - prevK * GAP_PENALTY;
          if (val > runningMax) runningMax = val;
        }
      }

      if (lowerHaystack.charCodeAt(j) === charCode) {
        let bestScore = -100000;
        let bestPrevIdx = -1;

        // 1. Gap match (from k < j-1)
        if (runningMax > -100000) {
          const gapScore = runningMax + MATCH_BONUS + j * GAP_PENALTY - GAP_PENALTY;
          if (gapScore > bestScore) {
            bestScore = gapScore;
            // Note: We don't store the exact k for gap matches here (optimization trade-off).
            // For backtracking, we'll scan for the best k in the backtracking phase if needed,
            // or we accept that we might not pick the absolute perfect path for highlighting
            // if there are multiple identical scores.
            // However, to be safe, let's just do the scan since N*M is small.
          }
        }

        // Re-scanning for correctness of P[i*m+j]
        // This overrides the O(1) logic but guarantees correct highlighting path
        bestScore = -100000;

        // Check consecutive (j-1)
        if (prevM[j - 1] > -100000) {
          const s = prevM[j - 1] + MATCH_BONUS + CONSECUTIVE_BONUS;
          if (s > bestScore) {
            bestScore = s;
            bestPrevIdx = j - 1;
          }
        }

        // Check gaps (0 to j-2)
        for (let k = 0; k < j - 1; k++) {
          if (prevM[k] <= -100000) continue;
          const dist = j - k - 1;

          // Apply distance penalty
          // We need to be careful not to make gaps too cheap vs consecutive
          // Consecutive bonus is +20.
          // Gap penalty is -2 * dist.
          // A gap of 1 (dist=1) -> -2.
          // So consecutive is much better (+20 vs -2).
          const s = prevM[k] + MATCH_BONUS + dist * GAP_PENALTY;
          if (s > bestScore) {
            bestScore = s;
            bestPrevIdx = k;
          }
        }

        if (bestScore > -100000) {
          if (isWordStart(j)) {
            bestScore += WORD_START_BONUS;
          }
          currM[j] = bestScore;
          P[i * m + j] = bestPrevIdx;
        }
      }
    }
  }

  // Find best end position
  let maxScore = -100000;
  let endPos = -1;
  for (let j = 0; j < m; j++) {
    if (currM[j] > maxScore) {
      maxScore = currM[j];
      endPos = j;
    }
  }

  if (endPos === -1) return null;

  // Backtrack
  const positions = new Array(n);
  let curr = endPos;
  for (let i = n - 1; i >= 0; i--) {
    positions[i] = curr;
    if (i > 0) {
      curr = P[i * m + curr];
    }
  }

  return { score: maxScore, positions };
}

function toRanges(positions: number[]): Array<[number, number]> {
  if (positions.length === 0) {
    return [];
  }

  const ranges: Array<[number, number]> = [];
  let start = positions[0];
  let previous = positions[0];

  for (let i = 1; i < positions.length; i++) {
    const current = positions[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push([start, previous + 1]);
    start = current;
    previous = current;
  }

  ranges.push([start, previous + 1]);
  return ranges;
}

function shiftRanges(ranges: Array<[number, number]>, offset: number): Array<[number, number]> {
  if (offset <= 0) {
    return ranges;
  }

  const shifted: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const s = start + offset;
    const e = end + offset;
    shifted.push([s, e]);
  }
  return shifted;
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const replaced = (trimmed as any).replaceAll("\\", "/");
  const normalized = path.posix.normalize(replaced);
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    return "";
  }

  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}
