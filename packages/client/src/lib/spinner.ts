import type { CSSProperties } from "react";

const DEFAULT_SPIN_DURATION_MS = 1_000;

export function getSyncedSpinStyle(durationMs = DEFAULT_SPIN_DURATION_MS): CSSProperties {
  const safeDurationMs = Math.max(1, Math.floor(durationMs));
  const offsetMs = Date.now() % safeDurationMs;

  return {
    animationDuration: `${safeDurationMs}ms`,
    animationDelay: `-${offsetMs}ms`,
  };
}
