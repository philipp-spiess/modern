import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ThreadSummary, type WorkspaceThreads } from "@moderndev/server/src/extensions/agent/threads";
import type { WorkspaceThreadSelection } from "@moderndev/server/src/state";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Archive,
  Ellipsis,
  FolderClosedIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranch,
  LoaderCircle,
  PanelLeftClose,
  SquarePen,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import {
  activateProject,
  archiveThread,
  openProject,
  openProjectWithNewThread,
  openProjectWithThread,
  removeProject,
  setProjectExpanded,
} from "../lib/project";
import { orpc } from "../lib/rpc";
import { getSyncedSpinStyle } from "../lib/spinner";
import { toggleSidebar } from "../lib/sidebar-store";
import { basename } from "../utils/path";
import SidebarUpdaterBadge from "./sidebar-updater-badge";

type SidebarProps = {
  activeCwd: string;
  activeThread: WorkspaceThreadSelection | null;
  projects: readonly string[];
  expandedByProject: Record<string, boolean>;
};

type RegisteredCommand = {
  command: string;
  defaultKeybinding?: {
    key: string;
  };
};

function Sidebar({ activeCwd, activeThread, projects, expandedByProject }: SidebarProps) {
  const workspaceThreadsQuery = useSuspenseQuery({
    ...orpc.agent.threadsActivityWatch.experimental_liveOptions({
      input: {
        projects: [...projects],
      },
      context: { cache: true },
      retry: true,
    }),
    queryKey: ["agent", "threadsActivityWatch", projects.join("|")],
  });

  const commandsQuery = useSuspenseQuery(
    orpc.commands.list.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const toggleSidebarShortcut = useMemo(() => {
    const commands = (commandsQuery.data as readonly RegisteredCommand[]) ?? [];
    return commands.find((entry) => entry.command === "view.toggleSidebar")?.defaultKeybinding?.key ?? "cmd+b";
  }, [commandsQuery.data]);

  const threadsByWorkspace = useMemo(() => {
    const groups = (workspaceThreadsQuery.data?.projects as WorkspaceThreads[] | undefined) ?? [];
    return new Map<string, ThreadSummary[]>(groups.map((group) => [group.cwd, group.threads]));
  }, [workspaceThreadsQuery.data?.projects]);

  const activeThreadPath = activeThread?.kind === "existing" ? activeThread.threadPath : null;
  const isNewThreadActive = activeThread?.kind === "draft";

  const onAddProject = useCallback(async () => {
    await openProject();
  }, []);

  const onActivateProject = useCallback(
    async (cwd: string) => {
      if (cwd === activeCwd) {
        return;
      }
      await activateProject(cwd);
    },
    [activeCwd],
  );

  const onToggleProjectExpanded = useCallback(
    async (cwd: string) => {
      const expanded = expandedByProject[cwd] ?? true;
      await setProjectExpanded(cwd, !expanded);
    },
    [expandedByProject],
  );

  const onOpenThread = useCallback(async (cwd: string, thread: ThreadSummary) => {
    await openProjectWithThread(thread.workspaceCwd || cwd, thread.path, thread.title);
  }, []);

  const onCreateThread = useCallback(async () => {
    await openProjectWithNewThread(activeCwd);
  }, [activeCwd]);

  const onCreateThreadForProject = useCallback(async (cwd: string) => {
    await openProjectWithNewThread(cwd);
  }, []);

  const onRemoveProject = useCallback(async (cwd: string) => {
    await removeProject(cwd);
  }, []);

  const onArchiveThread = useCallback(async (cwd: string, threadPath: string, isActiveThread: boolean) => {
    await archiveThread(cwd, threadPath);
    if (isActiveThread) {
      await openProjectWithNewThread(cwd);
    }
  }, []);

  return (
    <div className="flex max-h-screen h-full flex-col p-2 pr-1">
      <div data-tauri-drag-region className="h-10 shrink-0 flex items-center justify-between">
        <div className="ml-1.5">
          <SidebarUpdaterBadge />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => toggleSidebar()}
              className="mr-1.75 flex size-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-300"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="flex items-center gap-2">
            <span>Toggle Sidebar</span>
            <span className="shrink-0 rounded border px-1.5 py-0.25 text-[10px] uppercase tracking-wide opacity-80">
              {toggleSidebarShortcut}
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 min-w-0 select-none flex-col overflow-y-auto p-2 pt-0 gap-4">
        <div className="p-1 w-full">
          <button
            type="button"
            onClick={() => void onCreateThread()}
            className={cn(
              "rounded-md px-2.5 -mx-2.5 flex w-[calc(100%+1.25rem)] items-center gap-2 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white",
              isNewThreadActive && "bg-white/8 text-white",
            )}
          >
            <SquarePen className="size-3.5 shrink-0 text-white/70" />
            <span>New Thread</span>
          </button>
        </div>

        <section className="p-1 w-full">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-white/50">Projects</h2>
            <div className="flex items-center gap-0.5">
              <Button onClick={() => void onAddProject()} variant="ghost" className="-mr-1.25 size-6 p-0 text-white/50">
                <FolderPlusIcon className="size-3.5" />
              </Button>
            </div>
          </div>

          <ul className="mt-2 flex flex-col w-full">
            {projects.map((cwd) => (
              <WorkspaceItem
                key={cwd}
                cwd={cwd}
                expanded={expandedByProject[cwd] ?? true}
                activeThreadPath={cwd === activeCwd ? activeThreadPath : null}
                threads={threadsByWorkspace.get(cwd) ?? []}
                onActivate={onActivateProject}
                onToggleExpanded={onToggleProjectExpanded}
                onOpenThread={onOpenThread}
                onCreateThread={onCreateThreadForProject}
                onRemoveWorkspace={onRemoveProject}
                onArchiveThread={onArchiveThread}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function WorkspaceItem({
  cwd,
  expanded,
  activeThreadPath,
  threads,
  onActivate,
  onToggleExpanded,
  onOpenThread,
  onCreateThread,
  onRemoveWorkspace,
  onArchiveThread,
}: {
  cwd: string;
  expanded: boolean;
  activeThreadPath: string | null;
  threads: ThreadSummary[];
  onActivate: (cwd: string) => Promise<void>;
  onToggleExpanded: (cwd: string) => Promise<void>;
  onOpenThread: (cwd: string, thread: ThreadSummary) => Promise<void>;
  onCreateThread: (cwd: string) => Promise<void>;
  onRemoveWorkspace: (cwd: string) => Promise<void>;
  onArchiveThread: (cwd: string, threadPath: string, isActiveThread: boolean) => Promise<void>;
}) {
  const FolderIcon = expanded ? FolderOpenIcon : FolderClosedIcon;

  return (
    <li className="w-full">
      <div className="-mx-2.5 w-[calc(100%+1.25rem)] py-0.5">
        <div className="group relative flex w-full items-center gap-1 px-2.5">
          <div className="pointer-events-none absolute inset-0 rounded-md transition-colors group-hover:bg-white/10" />
          <button
            type="button"
            onClick={() => {
              void (async () => {
                await onActivate(cwd);
                await onToggleExpanded(cwd);
              })();
            }}
            className={cn(
              "relative z-10 cursor-pointer rounded-md flex min-w-0 flex-1 items-center gap-2 py-1.5 text-xs text-white/80 group-hover:text-white",
            )}
          >
            <FolderIcon className="size-3.5 shrink-0 text-white/70" />
            <div className="truncate text-xs">{basename(cwd)}</div>
          </button>

          <div className="-mr-1.25 relative z-10 flex shrink-0 items-center opacity-0 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="size-6 rounded-md p-0 text-white/50 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 group-hover:text-white/70 hover:text-white/80"
                  aria-label={`Project actions for ${basename(cwd)}`}
                >
                  <Ellipsis className="mx-auto size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                <DropdownMenuItem onSelect={() => void onRemoveWorkspace(cwd)}>
                  <Trash2 className="size-4" />
                  Remove Project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={() => void onCreateThread(cwd)}
              className="size-6 rounded-md p-0 text-white/50 group-hover:text-white/70 hover:text-white/80"
              aria-label={`New thread in ${basename(cwd)}`}
            >
              <SquarePen className="mx-auto size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {expanded && threads.length > 0 && (
        <ul className="mt-0.5 mb-1 -mx-2.5">
          {threads.map((thread) => {
            const isActiveThread = activeThreadPath === thread.path;
            const isWorktreeThread = thread.workspaceCwd !== cwd;

            return (
              <li key={thread.id} className="group/thread relative">
                <button
                  type="button"
                  onClick={() => void onOpenThread(cwd, thread)}
                  className={cn(
                    "relative flex w-full px-2.5 hover:bg-white/10 items-center text-xs gap-1 rounded-md py-1.5 pl-8 text-left text-white/60 hover:text-white/70",
                    isActiveThread && "bg-white/8 text-white/80",
                  )}
                >
                  <span className="pointer-events-none absolute inset-y-0 left-0 inline-flex w-8 items-center justify-center">
                    {thread.isStreaming ? (
                      <LoaderCircle className="size-3 animate-spin text-white/45" style={getSyncedSpinStyle()} />
                    ) : thread.hasUnread ? (
                      <span className="size-2 rounded-full bg-amber-400" />
                    ) : null}
                  </span>

                  <span className="min-w-0 flex-1">
                    {thread.isTitleGenerating ? (
                      <ThreadTitleShimmer seed={thread.id} />
                    ) : (
                      <span className="block truncate">{thread.title}</span>
                    )}
                  </span>
                  {isWorktreeThread ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex shrink-0 items-center">
                          <GitBranch className="size-3 text-neutral-500" aria-hidden strokeWidth={1.75} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6}>
                        <span>Workspace: {basename(thread.workspaceCwd)}</span>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <span className="shrink-0 text-xs text-white/35 group-hover/thread:opacity-0">
                    {formatRelativeAge(thread.updatedAt)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void onArchiveThread(cwd, thread.path, isActiveThread)}
                  className="absolute top-1/2 right-2.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-white/35 opacity-0 hover:bg-white/10 hover:text-white/75 group-hover/thread:opacity-100"
                  aria-label={`Archive thread ${thread.title}`}
                  title="Archive thread"
                >
                  <Archive className="size-3" />
                </button>
              </li>
            );
          })}
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

export default memo(Sidebar);
