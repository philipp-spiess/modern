import type { WorkspaceExistingThreadSelection, WorkspaceThreadSelection } from "@moderndev/server/src/state";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Clipboard, Columns2, Ellipsis, GitCompare, PanelLeftClose, Rows3 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toggleDiffStyle, useDiffStyleStore } from "../extensions/agent/diff-style-context";
import AgentChatPanel from "../extensions/agent/chat";
import { client, orpc } from "../lib/rpc";
import { toggleSidebar, useSidebarVisible } from "../lib/sidebar-store";
import { useHandle } from "../lib/use-handle";
import { basename } from "../utils/path";
import { Tabs } from "./tabs";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type WorkspaceShellProps = {
  active: boolean;
  workspaceCwd: string;
  activeThread: WorkspaceThreadSelection | null;
};

type GitSummary = {
  filesChanged: number;
  insertions: number;
  deletions: number;
};

function ThreadHeader({
  title,
  threadPath,
  workspaceCwd,
  sidebarVisible,
  summary,
  onShowChanges,
}: {
  title: string;
  threadPath: string | null;
  workspaceCwd: string;
  sidebarVisible: boolean;
  summary: GitSummary;
  onShowChanges: () => void;
}) {
  const diffStyle = useDiffStyleStore();

  return (
    <div
      data-tauri-drag-region
      className={
        sidebarVisible
          ? "flex h-10 shrink-0 select-none items-center border-b border-white/10 px-3 text-sm text-white/70"
          : "flex h-10 shrink-0 select-none items-center border-b border-white/10 pl-21 pr-3 text-sm text-white/70"
      }
    >
      {!sidebarVisible && (
        <button
          type="button"
          onClick={() => toggleSidebar()}
          className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-300"
          aria-label="Expand sidebar"
        >
          <PanelLeftClose className="size-3.5" />
        </button>
      )}
      <span data-tauri-drag-region className="min-w-0 flex-1 truncate">
        {title}
      </span>

      <div className="flex items-center gap-1">
        {summary.filesChanged > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onShowChanges}
            className="h-6 shrink-0 gap-1.5 border border-white/12 px-2 text-xs hover:bg-white/8"
            aria-label={formatSummaryAriaLabel(summary)}
            title={formatSummaryAriaLabel(summary)}
          >
            <GitCompare className="size-3 text-white/45" aria-hidden strokeWidth={1.75} />
            <span className="font-medium text-emerald-400/80">+{summary.insertions}</span>
            <span className="font-medium text-rose-400/80">-{summary.deletions}</span>
          </Button>
        ) : null}

        {threadPath && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-7 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/5 hover:text-white/70 outline-hidden ring-0 focus:outline-hidden focus:ring-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:outline-hidden data-[state=open]:ring-0"
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(workspaceCwd)}>
                <Clipboard className="size-4" />
                Copy working directory
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(threadPath)}>
                <Clipboard className="size-4" />
                Copy session ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => toggleDiffStyle()}>
                {diffStyle === "split" ? <Rows3 className="size-4" /> : <Columns2 className="size-4" />}
                {diffStyle === "split" ? "Stacked diffs" : "Split diffs"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

function WorkspaceShell({ active, workspaceCwd, activeThread }: WorkspaceShellProps) {
  const sidebarVisible = useSidebarVisible();
  const [hasOpenTabs, setHasOpenTabs] = useState(false);
  const shellContainerRef = useRef<HTMLDivElement | null>(null);
  const [tabsPercent, tabsHandleProps] = useHandle("horizontal", `workspace-tabs-width:${workspaceCwd}`, 50, {
    invert: true,
    min: 15,
    max: 80,
    unit: "percent",
    containerRef: shellContainerRef,
  });

  const { data: gitSummaryData } = useSuspenseQuery(
    orpc.git.summaryWatch.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const gitSummary = useMemo(
    () => ({
      filesChanged: gitSummaryData.filesChanged,
      insertions: gitSummaryData.insertions,
      deletions: gitSummaryData.deletions,
    }),
    [gitSummaryData.deletions, gitSummaryData.filesChanged, gitSummaryData.insertions],
  );

  const handleShowChanges = useCallback(() => {
    void client.commands.run({
      command: "review.showChanges",
      workspaceCwd,
    });
  }, [workspaceCwd]);

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

  const tabsPaneWidth = `${tabsPercent}%`;

  return (
    <div ref={shellContainerRef} className="absolute inset-0 flex size-full min-h-0">
      <div
        className={
          hasOpenTabs
            ? sidebarVisible
              ? "min-w-0 flex-1 p-2 pl-1 pr-1"
              : "min-w-0 flex-1 p-2 pr-1"
            : sidebarVisible
              ? "min-w-0 flex-1 p-2 pl-1"
              : "min-w-0 flex-1 p-2"
        }
      >
        <div className="flex size-full min-h-0 flex-col rounded-lg bg-neutral-900/75 shadow inset-shadow-sm inset-shadow-white/3 outline -outline-offset-1 outline-white/10">
          <ThreadHeader
            title={
              isDraftActive
                ? resolveDraftThreadTitle(activeThread)
                : selectedThread
                  ? resolveThreadTitle(selectedThread)
                  : "No thread selected"
            }
            threadPath={activeThreadPath}
            workspaceCwd={workspaceCwd}
            sidebarVisible={sidebarVisible}
            summary={gitSummary}
            onShowChanges={handleShowChanges}
          />

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
            ? "group relative h-full w-0 shrink-0 select-none cursor-col-resize"
            : "pointer-events-none relative h-full w-0 shrink-0 opacity-0"
        }
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-px -translate-x-1/2 rounded bg-gradient-to-b from-transparent via-white/0 to-transparent transition-all duration-150 ease-in-out group-hover:w-[3px] group-hover:via-white/20 group-active:via-white/20" />
        <div
          {...tabsHandleProps}
          role="separator"
          aria-label="Resize workspace tabs"
          aria-orientation="vertical"
          className="absolute -inset-x-2 inset-y-0 cursor-col-resize touch-none"
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

function formatSummaryAriaLabel(summary: GitSummary): string {
  const fileLabel = summary.filesChanged === 1 ? "file" : "files";
  return `${summary.filesChanged} ${fileLabel} changed, ${summary.insertions} insertion${summary.insertions === 1 ? "" : "s"}, ${summary.deletions} deletion${summary.deletions === 1 ? "" : "s"}`;
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

export default memo(WorkspaceShell);
