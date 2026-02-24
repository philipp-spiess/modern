import { createContext, useContext, useSyncExternalStore } from "react";

export type DiffStyle = "unified" | "split";

// ---------------------------------------------------------------------------
// React context – used inside the agent chat panel tree so nested components
// (e.g. EditToolView) can read the current diff style without prop drilling.
// ---------------------------------------------------------------------------

export const DiffStyleContext = createContext<DiffStyle>("unified");

export function useDiffStyle(): DiffStyle {
  return useContext(DiffStyleContext);
}

// ---------------------------------------------------------------------------
// Tiny module-level store – allows the header actions component (rendered by
// dockview outside the panel tree) to read and toggle the diff style.
// ---------------------------------------------------------------------------

export const DIFF_STYLE_KEY = "agent:diffStyle";

let currentStyle: DiffStyle = readFromStorage();
const listeners = new Set<() => void>();

function readFromStorage(): DiffStyle {
  try {
    const v = localStorage.getItem(DIFF_STYLE_KEY);
    if (v === "split" || v === "unified") return v;
  } catch {}
  return "unified";
}

function emitChange() {
  for (const fn of listeners) fn();
}

export function getDiffStyle(): DiffStyle {
  return currentStyle;
}

export function setDiffStyle(style: DiffStyle) {
  if (style === currentStyle) return;
  currentStyle = style;
  try {
    localStorage.setItem(DIFF_STYLE_KEY, style);
  } catch {}
  emitChange();
}

export function toggleDiffStyle() {
  setDiffStyle(currentStyle === "split" ? "unified" : "split");
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useDiffStyleStore(): DiffStyle {
  return useSyncExternalStore(subscribe, getDiffStyle, getDiffStyle);
}
