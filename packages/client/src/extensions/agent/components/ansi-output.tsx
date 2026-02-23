import { cn } from "@/lib/utils";
import type { Ghostty as GhosttyType, GhosttyCell } from "ghostty-web";
import ghosttyWasmUrl from "ghostty-web/ghostty-vt.wasm?url";
import { Fragment, memo, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Lazy singleton – loads Ghostty WASM once
// ---------------------------------------------------------------------------

let ghosttyInstance: GhosttyType | null = null;
let ghosttyLoading: Promise<GhosttyType> | null = null;

async function loadGhostty(): Promise<GhosttyType> {
  if (ghosttyInstance) return ghosttyInstance;
  if (!ghosttyLoading) {
    ghosttyLoading = (async () => {
      const { Ghostty } = await import("ghostty-web");
      const instance = await Ghostty.load(ghosttyWasmUrl);
      ghosttyInstance = instance;
      return instance;
    })();
  }
  return ghosttyLoading;
}

// ---------------------------------------------------------------------------
// ANSI detection
// ---------------------------------------------------------------------------

/** Check if text contains ANSI escape sequences */
export function containsAnsi(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /\x1b\[/.test(text);
}

// ---------------------------------------------------------------------------
// Cell → styled spans conversion
// ---------------------------------------------------------------------------

interface StyledSpan {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
}

interface DefaultColors {
  fgR: number;
  fgG: number;
  fgB: number;
  bgR: number;
  bgG: number;
  bgB: number;
}

function cellsToLines(cells: GhosttyCell[], cols: number, rows: number, defaults: DefaultColors): StyledSpan[][] {
  const result: StyledSpan[][] = [];

  for (let row = 0; row < rows; row++) {
    const spans: StyledSpan[] = [];
    let currentSpan: StyledSpan | null = null;

    // Find the last meaningful cell – include cells with visible chars OR non-default bg
    let lastNonEmpty = -1;
    for (let col = cols - 1; col >= 0; col--) {
      const cell = cells[row * cols + col];
      if (!cell) continue;
      const hasChar = cell.codepoint !== 0 && cell.codepoint !== 32;
      const hasExplicitBg = cell.bg_r !== defaults.bgR || cell.bg_g !== defaults.bgG || cell.bg_b !== defaults.bgB;
      if (hasChar || hasExplicitBg) {
        lastNonEmpty = col;
        break;
      }
    }

    for (let col = 0; col <= lastNonEmpty; col++) {
      const cell = cells[row * cols + col];
      if (!cell || cell.width === 0) continue; // Skip combining / wide continuation

      const char = cell.codepoint === 0 ? " " : String.fromCodePoint(cell.codepoint);

      // Only apply fg/bg if they differ from the terminal defaults
      const isDefaultFg = cell.fg_r === defaults.fgR && cell.fg_g === defaults.fgG && cell.fg_b === defaults.fgB;
      const isDefaultBg = cell.bg_r === defaults.bgR && cell.bg_g === defaults.bgG && cell.bg_b === defaults.bgB;

      const fg = isDefaultFg ? null : `rgb(${cell.fg_r},${cell.fg_g},${cell.fg_b})`;
      const bg = isDefaultBg ? null : `rgb(${cell.bg_r},${cell.bg_g},${cell.bg_b})`;
      const bold = !!(cell.flags & 1);
      const italic = !!(cell.flags & 2);
      const underline = !!(cell.flags & 4);
      const dim = !!(cell.flags & 128);

      if (
        currentSpan &&
        currentSpan.fg === fg &&
        currentSpan.bg === bg &&
        currentSpan.bold === bold &&
        currentSpan.italic === italic &&
        currentSpan.underline === underline &&
        currentSpan.dim === dim
      ) {
        currentSpan.text += char;
      } else {
        if (currentSpan) spans.push(currentSpan);
        currentSpan = { text: char, fg, bg, bold, italic, underline, dim };
      }
    }

    if (currentSpan) spans.push(currentSpan);
    result.push(spans);
  }

  // Trim trailing empty lines
  while (result.length > 0 && result[result.length - 1].length === 0) {
    result.pop();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Strip ANSI for plain-text fallback
// ---------------------------------------------------------------------------

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface AnsiOutputProps {
  content: string;
  className?: string;
}

export const AnsiOutput = memo(function AnsiOutput({ content, className }: AnsiOutputProps) {
  const [lines, setLines] = useState<StyledSpan[][] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadGhostty()
      .then((ghostty) => {
        if (cancelled) return;

        try {
          const textLines = content.split("\n");
          const rows = textLines.length + 2;
          // Measure visible line lengths (stripped of ANSI) to avoid wrapping
          const maxLen = Math.max(...textLines.map((l) => stripAnsi(l).length), 80);
          const cols = Math.max(maxLen + 10, 120);

          const term = ghostty.createTerminal(cols, rows);
          // Terminal needs \r\n for proper line breaks – raw tool output
          // only has \n (no tty onlcr conversion), so LF alone moves the
          // cursor down without returning to column 0.
          term.write(content.replace(/\r?\n/g, "\r\n"));
          term.update();

          // Get the terminal's default colors so we can exclude them from styling
          const colors = term.getColors();
          const defaults: DefaultColors = {
            fgR: colors.foreground.r,
            fgG: colors.foreground.g,
            fgB: colors.foreground.b,
            bgR: colors.background.r,
            bgG: colors.background.g,
            bgB: colors.background.b,
          };

          const cells = term.getViewport();
          const parsed = cellsToLines(cells, cols, rows, defaults);

          term.free();

          if (!cancelled) setLines(parsed);
        } catch {
          if (!cancelled) setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [content]);

  // Fallback while loading or on error – strip ANSI and show plain text
  if (!lines || error) {
    return (
      <pre className={cn("p-3 font-mono text-[13px] leading-5 whitespace-pre-wrap text-white/50", className)}>
        {stripAnsi(content)}
      </pre>
    );
  }

  return (
    <pre className={cn("p-3 font-mono text-[13px] leading-5 whitespace-pre-wrap text-white/50", className)}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          {line.map((span, j) => {
            const style: React.CSSProperties = {};
            if (span.fg) style.color = span.fg;
            if (span.bg) style.backgroundColor = span.bg;
            if (span.bold) style.fontWeight = "bold";
            if (span.italic) style.fontStyle = "italic";
            if (span.underline) style.textDecoration = "underline";
            if (span.dim) style.opacity = 0.6;

            const hasStyle = Object.keys(style).length > 0;
            return hasStyle ? (
              <span key={j} style={style}>
                {span.text}
              </span>
            ) : (
              <Fragment key={j}>{span.text}</Fragment>
            );
          })}
        </Fragment>
      ))}
    </pre>
  );
});
