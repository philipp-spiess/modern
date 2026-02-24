import { useEffect, useRef } from "react";

// ── Focus request bus (Tabs ↔ callers like command palette) ──

type Listener = (panelId: string) => void;

const listeners = new Set<Listener>();

export function onFocusPanel(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestFocusPanel(panelId: string): void {
  for (const listener of listeners) {
    listener(panelId);
  }
}

// ── Per-panel focus handlers (panel components register here) ──

const panelFocusHandlers = new Map<string, () => void>();

/**
 * Register a focus callback for a panel. Called by the Tabs component
 * when the panel should grab keyboard focus (e.g. after tab activation
 * or after another tab is closed).
 */
export function registerPanelFocus(panelId: string, handler: () => void): () => void {
  panelFocusHandlers.set(panelId, handler);
  return () => panelFocusHandlers.delete(panelId);
}

/**
 * Invoke the registered focus handler for a panel, if any.
 * Returns true if a handler was found and called.
 */
export function focusPanelContent(panelId: string): boolean {
  const handler = panelFocusHandlers.get(panelId);
  if (handler) {
    handler();
    return true;
  }
  return false;
}

/**
 * Hook for panel components to register a focus handler.
 * The callback is called when the panel should grab keyboard focus.
 *
 * @example
 * ```tsx
 * const terminalRef = useRef<Terminal>(null);
 * usePanelFocus(panelId, () => terminalRef.current?.focus());
 * ```
 */
export function usePanelFocus(panelId: string | undefined, handler: () => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!panelId) return;
    return registerPanelFocus(panelId, () => handlerRef.current());
  }, [panelId]);
}
