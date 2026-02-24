import { useSyncExternalStore } from "react";

const SIDEBAR_KEY = "ui:sidebarVisible";

let visible: boolean = readFromStorage();
const listeners = new Set<() => void>();

function readFromStorage(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY);
    if (v === "false") return false;
  } catch {}
  return true;
}

function emitChange() {
  for (const fn of listeners) fn();
}

export function getSidebarVisible(): boolean {
  return visible;
}

export function setSidebarVisible(value: boolean) {
  if (value === visible) return;
  visible = value;
  try {
    localStorage.setItem(SIDEBAR_KEY, String(value));
  } catch {}
  emitChange();
}

export function toggleSidebar() {
  setSidebarVisible(!visible);
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function useSidebarVisible(): boolean {
  return useSyncExternalStore(subscribe, getSidebarVisible, getSidebarVisible);
}
