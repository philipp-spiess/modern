import type { WorkspaceExistingThreadSelection, WorkspaceThreadSelection } from "@diffs-io/server/src/state";
import { useEffect, useMemo, useState } from "react";
import AgentChatPanel from "../extensions/agent/chat";
import { useHandle } from "../lib/use-handle";
import { basename } from "../utils/path";
import { Tabs } from "./tabs";

type WorkspaceShellProps = {
  active: boolean;
  workspaceCwd: string;
  activeThread: WorkspaceThreadSelection | null;
};

export default function WorkspaceShell({ active, workspaceCwd, activeThread }: WorkspaceShellProps) {
  const [hasOpenTabs, setHasOpenTabs] = useState(false);
  const [tabsWidth, tabsHandleProps] = useHandle("horizontal", `workspace-tabs-width:${workspaceCwd}`, 560, {
    invert: true,
    min: 320,
  });

  const [activeThreadPath, setActiveThreadPath] = useState<string | null>(() => {
    const existing = toExistingThread(normalizeThreadSelection(activeThread));
    return existing?.threadPath ?? null;
  });
  const [isDraftActive, setIsDraftActive] = useState(() => normalizeThreadSelection(activeThread)?.kind === "draft");
  const [mountedThreads, setMountedThreads] = useState<WorkspaceExistingThreadSelection[]>(() => {
    const existing = toExistingThread(normalizeThreadSelection(activeThread));
    return existing ? [existing] : [];
  });

  useEffect(() => {
    if (!active) {
      return;
    }

    const normalizedActiveThread = normalizeThreadSelection(activeThread);
    if (!normalizedActiveThread) {
      setIsDraftActive(false);
      setActiveThreadPath(null);
      return;
    }

    if (normalizedActiveThread.kind === "draft") {
      setIsDraftActive(true);
      setActiveThreadPath(null);
      return;
    }

    setIsDraftActive(false);
    setActiveThreadPath(normalizedActiveThread.threadPath);
    setMountedThreads((current) => upsertMountedThread(current, normalizedActiveThread));
  }, [active, activeThread]);

  const selectedThread = useMemo(() => {
    if (!activeThreadPath) {
      return null;
    }

    return mountedThreads.find((thread) => thread.threadPath === activeThreadPath) ?? null;
  }, [activeThreadPath, mountedThreads]);

  const tabsPaneWidth = `${tabsWidth}px`;

  return (
    <div className="absolute inset-0 flex size-full min-h-0">
      <div className={hasOpenTabs ? "min-w-0 flex-1 p-2 pl-1 pr-1" : "min-w-0 flex-1 p-2 pl-1"}>
        <div className="flex size-full min-h-0 flex-col rounded-lg bg-neutral-900/75 shadow inset-shadow-sm inset-shadow-white/3 outline -outline-offset-1 outline-white/10">
          <div
            data-tauri-drag-region
            className="flex h-10 shrink-0 select-none items-center border-b border-white/10 px-3 text-sm text-white/70"
          >
            <span data-tauri-drag-region className="truncate">
              {isDraftActive
                ? resolveDraftThreadTitle(activeThread)
                : selectedThread
                  ? resolveThreadTitle(selectedThread)
                  : "No thread selected"}
            </span>
          </div>

          <div className="relative min-h-0 flex-1">
            {mountedThreads.map((thread) => {
              const isVisible = !isDraftActive && thread.threadPath === activeThreadPath;
              return (
                <div
                  key={thread.threadPath}
                  aria-hidden={!isVisible}
                  className={isVisible ? "absolute inset-0" : "absolute inset-0 pointer-events-none opacity-0"}
                >
                  <AgentChatPanel state={{ threadPath: thread.threadPath }} workspaceCwd={workspaceCwd} />
                </div>
              );
            })}

            {isDraftActive ? (
              <div className="absolute inset-0">
                <AgentChatPanel state={{ mode: "draft" }} workspaceCwd={workspaceCwd} />
              </div>
            ) : null}

            {!isDraftActive && !activeThreadPath ? (
              <div className="flex size-full items-center justify-center p-8 text-sm text-white/45">
                Select a thread to continue.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        aria-hidden={!hasOpenTabs}
        className={
          hasOpenTabs
            ? "group relative h-full w-0 shrink-0 select-none cursor-ew-resize"
            : "pointer-events-none relative h-full w-0 shrink-0 opacity-0"
        }
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-px -translate-x-1/2 rounded bg-white/0 transition-all duration-150 ease-in-out group-hover:w-[3px] group-hover:bg-white/20 group-active:bg-white/20" />
        <div
          {...tabsHandleProps}
          role="separator"
          aria-label="Resize workspace tabs"
          aria-orientation="vertical"
          className="absolute -inset-x-2 inset-y-0 cursor-ew-resize"
        />
      </div>

      <div
        aria-hidden={!hasOpenTabs}
        style={hasOpenTabs ? { width: tabsPaneWidth } : undefined}
        className={
          hasOpenTabs
            ? "min-h-0 min-w-0 shrink-0"
            : "pointer-events-none min-h-0 w-0 min-w-0 shrink-0 overflow-hidden opacity-0"
        }
      >
        <Tabs active={active} workspaceCwd={workspaceCwd} onHasOpenTabsChange={setHasOpenTabs} />
      </div>
    </div>
  );
}

function normalizeThreadSelection(selection: WorkspaceThreadSelection | null): WorkspaceThreadSelection | null {
  if (!selection) {
    return null;
  }

  const title = selection.title?.trim();

  if (selection.kind === "draft") {
    return {
      kind: "draft",
      ...(title ? { title } : {}),
    };
  }

  const threadPath = selection.threadPath?.trim();
  if (!threadPath) {
    return null;
  }

  return {
    kind: "existing",
    threadPath,
    ...(title ? { title } : {}),
  };
}

function toExistingThread(selection: WorkspaceThreadSelection | null): WorkspaceExistingThreadSelection | null {
  if (!selection || selection.kind !== "existing") {
    return null;
  }

  return selection;
}

function upsertMountedThread(
  mounted: WorkspaceExistingThreadSelection[],
  nextSelection: WorkspaceExistingThreadSelection,
): WorkspaceExistingThreadSelection[] {
  const index = mounted.findIndex((thread) => thread.threadPath === nextSelection.threadPath);
  if (index < 0) {
    return [...mounted, nextSelection];
  }

  const existing = mounted[index];
  if (existing && (existing.title ?? "") === (nextSelection.title ?? "")) {
    return mounted;
  }

  const updated = [...mounted];
  updated[index] = nextSelection;
  return updated;
}

function resolveThreadTitle(selection: WorkspaceExistingThreadSelection): string {
  const title = selection.title?.trim();
  if (title) {
    return title;
  }

  const fallback = basename(selection.threadPath).replace(/\.jsonl$/i, "");
  return fallback || "Thread";
}

function resolveDraftThreadTitle(selection: WorkspaceThreadSelection | null): string {
  if (selection?.kind !== "draft") {
    return "New Thread";
  }

  const title = selection.title?.trim();
  return title || "New Thread";
}
