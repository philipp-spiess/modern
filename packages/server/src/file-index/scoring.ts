import path from "path";

export interface FileEntry {
  path: string;
  lowerPath: string;
  basename: string;
  lowerBasename: string;
  depth: number;
}

export interface QuickOpenHit {
  path: string;
  score: number;
  basenameHighlights: Array<[number, number]>;
  pathHighlights: Array<[number, number]>;
}

interface FuzzyMatch {
  score: number;
  positions: number[];
}

export function toEntry(relPath: string): FileEntry {
  const basename = relPath.split("/").pop() ?? relPath;
  return {
    path: relPath,
    lowerPath: relPath.toLowerCase(),
    basename,
    lowerBasename: basename.toLowerCase(),
    depth: Math.max(0, relPath.split("/").length - 1),
  };
}

export function matchEntry(entry: FileEntry, needle: string): QuickOpenHit | null {
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

export function quickOpenFromEntries(entries: FileEntry[], query: string, limit: number): QuickOpenHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const matches: QuickOpenHit[] = [];
  for (const entry of entries) {
    const match = matchEntry(entry, needle);
    if (match) {
      matches.push(match);
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.path.localeCompare(b.path);
  });

  return matches.slice(0, limit);
}

export function fuzzyMatch(needle: string, lowerHaystack: string, originalHaystack: string): FuzzyMatch | null {
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

export function toRanges(positions: number[]): Array<[number, number]> {
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

export function shiftRanges(ranges: Array<[number, number]>, offset: number): Array<[number, number]> {
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

export function normalizePath(value: string): string {
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
