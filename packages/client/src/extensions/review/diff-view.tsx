import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, Rows3 } from "lucide-react";
import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionPanelProps } from "../../lib/extensions";
import { client, orpc } from "../../lib/rpc";
import { requestFocusPanel } from "../../lib/tab-focus";
import { setDiffStyle, useDiffStyleStore } from "../agent/diff-style-context";
import { areSetsEqual, getChangedPaths, getFileStageState, normalizePath, type StatusFile } from "./diff-view.helpers";

interface DiffViewState {
  focusPath?: string;
}

interface WorkingChangeFile {
  path: string;
  kind: "modified" | "added" | "deleted" | "renamed" | "untracked";
}

interface WorkingChangesSnapshot {
  patch: string;
  files: WorkingChangeFile[];
  generatedAt: number;
}

const noStatusFiles: StatusFile[] = [];
const noWorkingChangeFiles: WorkingChangeFile[] = [];

const WORKER_POOL_OPTIONS = {
  workerFactory: () => new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
  poolSize: 4,
  totalASTLRUCacheSize: 100,
};

const HIGHLIGHTER_OPTIONS = {
  theme: "vitesse-dark",
  lineDiffType: "word-alt",
} as const;

const DIFFS_PATCH_CSS =
  ":host, [data-diffs], [data-line], [data-column-number] { --diffs-bg: transparent; } [data-column-number] { border-right: none !important; } pre { background: transparent !important; }";

function parsePatchByPath(patch: string): { filesByPath: Map<string, FileDiffMetadata>; parseError: string | null } {
  if (!patch.trim()) {
    return {
      filesByPath: new Map(),
      parseError: null,
    };
  }

  try {
    const filesByPath = new Map<string, FileDiffMetadata>();
    const parsedPatches = parsePatchFiles(patch);
    for (const parsedPatch of parsedPatches) {
      for (const file of parsedPatch.files) {
        filesByPath.set(normalizePath(file.name), file);
      }
    }

    if (filesByPath.size === 0) {
      return {
        filesByPath,
        parseError: "Patch data was returned but could not be parsed into file diffs.",
      };
    }

    return {
      filesByPath,
      parseError: null,
    };
  } catch (error) {
    return {
      filesByPath: new Map(),
      parseError: error instanceof Error ? error.message : "Failed to parse patch.",
    };
  }
}

function DiffFileView({
  mode,
  fileDiff,
  fallback,
}: {
  mode: "split" | "unified";
  fileDiff: FileDiffMetadata;
  fallback: ReactNode;
}) {
  return (
    <DiffErrorBoundary fallback={fallback}>
      <FileDiff
        fileDiff={fileDiff}
        options={{
          theme: "vitesse-dark",
          diffStyle: mode,
          diffIndicators: "bars",
          lineDiffType: "word-alt",
          disableFileHeader: true,
          overflow: "scroll",
          expandUnchanged: false,
          unsafeCSS: DIFFS_PATCH_CSS,
        }}
      />
    </DiffErrorBoundary>
  );
}

export default function DiffViewPanel({ state, workspaceCwd }: ExtensionPanelProps<DiffViewState>) {
  const { focusPath } = state;
  const normalizedFocusPath = focusPath ? normalizePath(focusPath) : undefined;
  const diffViewMode = useDiffStyleStore();

  const { data: gitStatus } = useSuspenseQuery(
    orpc.git.statusWatch.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const { data: workingChangesData } = useSuspenseQuery(
    orpc.git.workingChangesWatch.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const files = (gitStatus?.files ?? noStatusFiles) as StatusFile[];
  const changedPaths = useMemo(() => getChangedPaths(files), [files]);
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  const workingChanges = (workingChangesData ?? {
    patch: "",
    files: noWorkingChangeFiles,
    generatedAt: Date.now(),
  }) as WorkingChangesSnapshot;

  const workingChangePaths = useMemo(
    () => (workingChanges.files ?? noWorkingChangeFiles).map((file) => file.path),
    [workingChanges.files],
  );

  const displayedPaths = useMemo(() => {
    const paths = new Set<string>(changedPaths);
    for (const path of workingChangePaths) {
      paths.add(path);
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
  }, [changedPaths, workingChangePaths]);

  const parsedDiff = useMemo(() => parsePatchByPath(workingChanges.patch ?? ""), [workingChanges.patch]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [jumpHighlightPath, setJumpHighlightPath] = useState<string | null>(null);
  const hasInitializedExpandedPathsRef = useRef(false);
  const previousFocusPathRef = useRef<string | undefined>(undefined);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (displayedPaths.length === 0) {
      hasInitializedExpandedPathsRef.current = false;
      previousFocusPathRef.current = focusPath;
      setExpandedPaths(new Set());
      return;
    }

    const focusChanged = previousFocusPathRef.current !== focusPath;
    previousFocusPathRef.current = focusPath;

    if (!hasInitializedExpandedPathsRef.current) {
      hasInitializedExpandedPathsRef.current = true;
      if (focusPath && displayedPaths.includes(focusPath)) {
        setExpandedPaths(new Set([focusPath]));
        return;
      }
      const initialPath = displayedPaths[0];
      setExpandedPaths(initialPath ? new Set([initialPath]) : new Set());
      return;
    }

    if (focusChanged && focusPath && displayedPaths.includes(focusPath)) {
      setExpandedPaths(new Set([focusPath]));
      return;
    }

    const pathSet = new Set(displayedPaths);
    setExpandedPaths((current) => {
      const next = new Set([...current].filter((path) => pathSet.has(path)));
      if (areSetsEqual(current, next)) {
        return current;
      }
      return next;
    });
  }, [displayedPaths, focusPath]);

  useEffect(() => {
    if (!normalizedFocusPath) {
      return;
    }

    const focusedPath = displayedPaths.find((path) => normalizePath(path) === normalizedFocusPath);
    if (!focusedPath) {
      return;
    }

    const target = sectionRefs.current.get(focusedPath);
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setJumpHighlightPath(focusedPath);
    const timeout = setTimeout(() => {
      setJumpHighlightPath((current) => (current === focusedPath ? null : current));
    }, 1400);

    return () => clearTimeout(timeout);
  }, [displayedPaths, normalizedFocusPath, workingChanges.patch]);

  const allExpanded = displayedPaths.length > 0 && displayedPaths.every((path) => expandedPaths.has(path));

  const toggleExpandedForPath = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAllExpanded = useCallback(() => {
    setExpandedPaths(() => (allExpanded ? new Set() : new Set(displayedPaths)));
  }, [allExpanded, displayedPaths]);

  const { mutate: stageAll, isPending: isStagingAll } = useMutation({
    mutationFn: async (paths: string[]) => {
      await Promise.all(paths.map((path) => client.git.stage({ path })));
    },
  });

  const { mutate: stageFile, isPending: isStageFilePending } = useMutation({
    mutationFn: async (path: string) => {
      await client.git.stage({ path });
    },
  });

  const { mutate: unstageFile, isPending: isUnstageFilePending } = useMutation({
    mutationFn: async (path: string) => {
      await client.git.unstage({ path });
    },
  });

  const handleStageAll = useCallback(() => {
    if (changedPaths.length === 0 || isStagingAll) {
      return;
    }
    stageAll(changedPaths);
  }, [changedPaths, isStagingAll, stageAll]);

  const isStagingMutationPending = isStagingAll || isStageFilePending || isUnstageFilePending;

  const handleToggleStage = useCallback(
    (path: string, checked: boolean) => {
      if (checked) {
        stageFile(path);
        return;
      }
      unstageFile(path);
    },
    [stageFile, unstageFile],
  );

  const openFile = useCallback(
    async (path: string) => {
      if (!workspaceCwd) {
        return;
      }

      const { result } = await client.commands.run({
        command: "files.open",
        args: [`${workspaceCwd}/${path}`],
        cwd: workspaceCwd,
      });
      const panelId = (result as any)?.panelId;
      if (panelId) {
        requestFocusPanel(panelId);
      }
    },
    [workspaceCwd],
  );

  const changes = useMemo(
    () =>
      displayedPaths.map((path) => {
        const statusFile = fileByPath.get(path);
        const normalized = normalizePath(path);
        return {
          path,
          stageState: getFileStageState(statusFile),
          stageAvailable: Boolean(statusFile),
          fileDiff: parsedDiff.filesByPath.get(normalized),
        };
      }),
    [displayedPaths, fileByPath, parsedDiff.filesByPath],
  );

  if (changes.length === 0) {
    return <div className="flex size-full items-center justify-center text-sm text-white/45">No changes.</div>;
  }

  return (
    <WorkerPoolContextProvider poolOptions={WORKER_POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      <div className="flex size-full min-h-0 flex-col p-2">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleAllExpanded}
              title={allExpanded ? "Collapse all files" : "Expand all files"}
              aria-label={allExpanded ? "Collapse all files" : "Expand all files"}
              className="rounded border border-white/12 p-1.5 text-white/75 hover:bg-white/8 hover:text-white"
            >
              {allExpanded ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setDiffStyle("unified")}
              title="Unified diff view"
              aria-label="Unified diff view"
              className={
                diffViewMode === "unified"
                  ? "rounded border border-cyan-400/50 bg-cyan-500/15 p-1.5 text-cyan-200"
                  : "rounded border border-white/12 p-1.5 text-white/75 hover:bg-white/8 hover:text-white"
              }
            >
              <Rows3 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setDiffStyle("split")}
              title="Split diff view"
              aria-label="Split diff view"
              className={
                diffViewMode === "split"
                  ? "rounded border border-cyan-400/50 bg-cyan-500/15 p-1.5 text-cyan-200"
                  : "rounded border border-white/12 p-1.5 text-white/75 hover:bg-white/8 hover:text-white"
              }
            >
              <Columns2 className="size-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleStageAll}
              disabled={changedPaths.length === 0 || isStagingAll}
              className="rounded border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStagingAll ? "Staging..." : "Stage All"}
            </button>
            <button
              type="button"
              onClick={() => {
                // TODO: implement commit flow.
              }}
              className="rounded border border-white/12 px-2 py-1 text-xs text-white/70 hover:bg-white/8 hover:text-white"
            >
              Commit
            </button>
          </div>
        </div>

        {parsedDiff.parseError ? (
          <div className="mb-2 rounded border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
            {parsedDiff.parseError}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex flex-col gap-2">
            {changes.map((change) => {
              const isExpanded = expandedPaths.has(change.path);
              const fallbackContent =
                workingChanges.patch.trim().length > 0
                  ? workingChanges.patch
                  : "No textual diff available for this file.";

              return (
                <section
                  key={change.path}
                  ref={(node) => {
                    if (node) {
                      sectionRefs.current.set(change.path, node);
                    } else {
                      sectionRefs.current.delete(change.path);
                    }
                  }}
                  className={
                    jumpHighlightPath === change.path
                      ? "overflow-hidden rounded-md border border-cyan-400/40 bg-black/20 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]"
                      : "overflow-hidden rounded-md border border-white/10 bg-black/20"
                  }
                >
                  <div className="flex items-center gap-2 border-b border-white/10 bg-white/4 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleExpandedForPath(change.path)}
                      className="shrink-0 text-white/80 hover:text-white"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                    </button>
                    <input
                      type="checkbox"
                      checked={change.stageState === "staged"}
                      ref={(node) => {
                        if (node) {
                          node.indeterminate = change.stageState === "partial";
                        }
                      }}
                      disabled={isStagingMutationPending || !change.stageAvailable}
                      onChange={(event) => handleToggleStage(change.path, event.currentTarget.checked)}
                      className="shrink-0"
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpandedForPath(change.path)}
                      className="min-w-0 flex-1 truncate text-left text-xs text-white/80 hover:text-white"
                    >
                      <span className="truncate">{change.path}</span>
                    </button>

                    {workspaceCwd ? (
                      <button
                        type="button"
                        onClick={() => void openFile(change.path)}
                        className="shrink-0 rounded border border-white/12 px-2 py-0.5 text-[10px] text-white/65 hover:bg-white/8 hover:text-white/90"
                      >
                        Open File
                      </button>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    <div className="p-2">
                      {change.fileDiff ? (
                        <DiffFileView
                          mode={diffViewMode}
                          fileDiff={change.fileDiff}
                          fallback={<pre className="overflow-x-auto p-3 text-xs text-white/50">{fallbackContent}</pre>}
                        />
                      ) : (
                        <pre className="overflow-x-auto rounded border border-white/8 p-3 text-xs text-white/50">
                          {fallbackContent}
                        </pre>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </WorkerPoolContextProvider>
  );
}

class DiffErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
