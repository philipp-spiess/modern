import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type ThreadSummary, type WorkspaceThreads } from "@diffs-io/server/src/extensions/agent/threads";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import {
  FolderClosedIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranch,
  type LucideIcon,
  SquareDot,
  SquareMinus,
  SquarePlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { client, orpc } from "../lib/rpc";
import { activateWorkspace, openWorkspace, setWorkspaceExpanded } from "../lib/workspace";
import { basename, dirname } from "../utils/path";

const noFiles: StatusFile[] = [];

type SidebarProps = {
  activeCwd: string;
  workspaces: readonly string[];
  expandedByWorkspace: Record<string, boolean>;
};

export default function Sidebar({ activeCwd, workspaces, expandedByWorkspace }: SidebarProps) {
  const { data } = useSuspenseQuery(
    orpc.git.statusWatch.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const workspaceThreadsQuery = useSuspenseQuery({
    ...orpc.agent.threadsList.queryOptions({
      queryKey: ["agent", "threadsList", workspaces.join("|")],
      input: {
        workspaces: [...workspaces],
      },
      context: { cache: true },
    }),
    refetchInterval: (query) => (hasPendingThreadTitles(query.state.data) ? 1_500 : false),
    refetchIntervalInBackground: true,
  });

  const files = (data?.files ?? noFiles) as StatusFile[];

  const threadsByWorkspace = useMemo(() => {
    const groups = (workspaceThreadsQuery.data?.workspaces as WorkspaceThreads[] | undefined) ?? [];
    return new Map<string, ThreadSummary[]>(groups.map((group) => [group.cwd, group.threads]));
  }, [workspaceThreadsQuery.data?.workspaces]);

  const stageMutation = useMutation(orpc.git.stage.mutationOptions({}));
  const unstageMutation = useMutation(orpc.git.unstage.mutationOptions({}));

  const orderedFiles = useMemo(() => {
    const kindRank: Record<ChangeKind, number> = {
      modified: 0,
      deleted: 1,
      added: 2,
    };

    return files
      .map((statusFile) => ({
        ...statusFile,
        state: getFileState(statusFile),
        kind: getChangeKind(statusFile),
      }))
      .sort((a, b) => {
        const rankDiff = kindRank[a.kind] - kindRank[b.kind];
        return rankDiff !== 0 ? rankDiff : a.path.localeCompare(b.path);
      });
  }, [files]);

  const handleToggle = (path: string, shouldStage: boolean) => {
    if (shouldStage) {
      stageMutation.mutate({ path });
    } else {
      unstageMutation.mutate({ path });
    }
  };

  const handleOpenDiff = useCallback(async (path: string, state: FileState) => {
    const mode = state === "staged" ? "staged" : "worktree";
    await client.commands.run({
      command: "review.openDiff",
      args: [path, mode],
    });
  }, []);

  const onAddWorkspace = useCallback(async () => {
    await openWorkspace();
  }, []);

  const onActivateWorkspace = useCallback(
    async (cwd: string) => {
      if (cwd === activeCwd) {
        return;
      }
      await activateWorkspace(cwd);
    },
    [activeCwd],
  );

  const onToggleWorkspaceExpanded = useCallback(
    async (cwd: string) => {
      const expanded = expandedByWorkspace[cwd] ?? true;
      await setWorkspaceExpanded(cwd, !expanded);
    },
    [expandedByWorkspace],
  );

  const onOpenThread = useCallback(
    async (cwd: string, thread: ThreadSummary) => {
      await onActivateWorkspace(cwd);
      await client.commands.run({
        command: "agent.openPanel",
        args: [
          {
            threadPath: thread.path,
            title: thread.title,
          },
        ],
        cwd,
      });
    },
    [onActivateWorkspace],
  );

  return (
    <div className="flex max-h-screen h-full flex-col p-2 pr-1">
      <div data-tauri-drag-region className="h-[30px] shrink-0" />
      <div className="flex min-h-0 flex-1 min-w-0 select-none flex-col overflow-y-auto p-2 gap-4">
        <section className="p-1 w-full">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-white/50">Threads</h2>
            <div className="flex items-center gap-0.5">
              <Button
                onClick={() => void onAddWorkspace()}
                variant="ghost"
                className="-mr-1.25 size-6 p-0 text-white/50"
              >
                <FolderPlusIcon className="size-3.5" />
              </Button>
            </div>
          </div>

          <ul className="mt-2 flex flex-col w-full">
            {workspaces.map((cwd) => (
              <WorkspaceItem
                key={cwd}
                cwd={cwd}
                expanded={expandedByWorkspace[cwd] ?? true}
                threads={threadsByWorkspace.get(cwd) ?? []}
                onActivate={onActivateWorkspace}
                onToggleExpanded={onToggleWorkspaceExpanded}
                onOpenThread={onOpenThread}
              />
            ))}
          </ul>
        </section>

        <section className="p-1 w-full">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs text-white/60 font-semibold">Changes</h2>
            {data?.current ? (
              <span className="inline-flex items-center gap-1 text-xs text-white/45">
                <GitBranch className="size-3" aria-hidden strokeWidth={1.75} />
                {data.current}
              </span>
            ) : null}
          </div>

          <ul className="mt-2 flex-1 overflow-y-auto">
            {orderedFiles.map((file) => {
              return (
                <li key={file.path}>
                  <FileCheckbox
                    label={file.path}
                    state={file.state}
                    kind={file.kind}
                    disabled={stageMutation.isPending || unstageMutation.isPending}
                    onChange={(checked) => handleToggle(file.path, checked)}
                    onOpenDiff={() => handleOpenDiff(file.path, file.state)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function WorkspaceItem({
  cwd,
  expanded,
  threads,
  onActivate,
  onToggleExpanded,
  onOpenThread,
}: {
  cwd: string;
  expanded: boolean;
  threads: ThreadSummary[];
  onActivate: (cwd: string) => Promise<void>;
  onToggleExpanded: (cwd: string) => Promise<void>;
  onOpenThread: (cwd: string, thread: ThreadSummary) => Promise<void>;
}) {
  const FolderIcon = expanded ? FolderOpenIcon : FolderClosedIcon;

  return (
    <li className="w-full">
      <button
        type="button"
        onClick={() => {
          void onActivate(cwd);
          void onToggleExpanded(cwd);
        }}
        className="hover:bg-white/10 rounded-md px-2.5 -mx-2.5 flex w-[calc(100%+1.25rem)] items-center gap-2 py-1.5 text-xs text-white/80 hover:text-white"
      >
        <FolderIcon className="size-3.5 shrink-0 text-white/70" />
        <div className="truncate text-xs">{basename(cwd)}</div>
      </button>

      {expanded && threads.length > 0 && (
        <ul className="mt-0.5 mb-1 -mx-2.5">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => void onOpenThread(cwd, thread)}
                className="flex w-full px-2.5 hover:bg-white/10 items-center text-xs gap-1 rounded-md py-1.5 pl-8 text-left text-white/60 hover:text-white/70"
              >
                <span className="min-w-0 flex-1">
                  {thread.isTitleGenerating ? (
                    <ThreadTitleShimmer seed={thread.id} />
                  ) : (
                    <span className="block truncate">{thread.title}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-white/35">{formatRelativeAge(thread.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const THREAD_TITLE_SHIMMER_VARIANTS = [
  ["w-20", "w-12", "w-16"],
  ["w-18", "w-14", "w-16"],
  ["w-22", "w-10", "w-16"],
  ["w-16", "w-14", "w-18"],
] as const;

function ThreadTitleShimmer({ seed }: { seed: string }) {
  const variant = THREAD_TITLE_SHIMMER_VARIANTS[hashSeed(seed) % THREAD_TITLE_SHIMMER_VARIANTS.length];

  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-3 animate-pulse rounded-sm bg-white/10", variant[0])} />
      <span className={cn("h-3 animate-pulse rounded-sm bg-white/10", variant[1])} />
      <span className={cn("h-3 animate-pulse rounded-sm bg-white/10", variant[2])} />
    </span>
  );
}

function hashSeed(seed: string): number {
  let hash = 0;

  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return hash;
}

function hasPendingThreadTitles(data: unknown): boolean {
  const workspaces = (data as { workspaces?: WorkspaceThreads[] } | undefined)?.workspaces;
  if (!workspaces?.length) {
    return false;
  }

  return workspaces.some((workspace) => workspace.threads.some((thread) => thread.isTitleGenerating));
}

function formatRelativeAge(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (elapsedMs < hour) {
    return `${Math.max(1, Math.floor(elapsedMs / minute))}m`;
  }

  if (elapsedMs < day) {
    return `${Math.max(1, Math.floor(elapsedMs / hour))}h`;
  }

  if (elapsedMs < week) {
    return `${Math.max(1, Math.floor(elapsedMs / day))}d`;
  }

  return `${Math.max(1, Math.floor(elapsedMs / week))}w`;
}

type FileState = "staged" | "partial" | "unstaged";

interface StatusFile {
  path: string;
  index: string;
  working_dir: string;
}

type ChangeKind = "added" | "deleted" | "modified";

const hasChange = (value: string) => value.trim() !== "" && value !== "?";

function getFileState(file: { index: string; working_dir: string }): FileState {
  const staged = hasChange(file.index);
  const unstaged = hasChange(file.working_dir);

  if (staged && !unstaged) {
    return "staged";
  }

  if (staged && unstaged) {
    return "partial";
  }

  return "unstaged";
}

interface FileCheckboxProps {
  label: string;
  state: FileState;
  kind: ChangeKind;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onOpenDiff: () => void;
}

function FileCheckbox({ label, state, kind, disabled, onChange, onOpenDiff }: FileCheckboxProps) {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (checkboxRef.current && state === "partial") {
      checkboxRef.current.indeterminate = true;
    }
  }, [state]);

  const { Component: IconComponent, wrapperClass } = getIcon(kind);

  return (
    <div className="flex items-center gap-1 truncate text-xs text-white/60">
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={state === "staged"}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="shrink-0"
      />
      <button
        type="button"
        onClick={onOpenDiff}
        className="flex items-center gap-1 truncate hover:text-white/80 transition-colors"
      >
        <span className={`flex size-5 shrink-0 items-center justify-center ${wrapperClass}`} aria-hidden>
          <IconComponent className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
        {basename(label)}
        <span className="text-xs text-white/40 truncate">{dirname(label)}</span>
      </button>
    </div>
  );
}

function getChangeKind(file: StatusFile): ChangeKind {
  const codes = `${file.index}${file.working_dir}`;

  if (codes.includes("D")) {
    return "deleted";
  }

  if (codes.includes("A") || codes.includes("?")) {
    return "added";
  }

  return "modified";
}

type IconConfig = {
  Component: LucideIcon;
  wrapperClass: string;
};

function getIcon(kind: ChangeKind): IconConfig {
  switch (kind) {
    case "added":
      return {
        Component: SquarePlus,
        wrapperClass: "text-emerald-400",
      };
    case "deleted":
      return {
        Component: SquareMinus,
        wrapperClass: "text-rose-400",
      };
    case "modified":
    default:
      return {
        Component: SquareDot,
        wrapperClass: "text-amber-400",
      };
  }
}
