import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, lineNumbers } from "@codemirror/view";
import { useMutation, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import shiki from "codemirror-shiki";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Rows3, SquareSplitVertical } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createHighlighter } from "shiki";
import type { ExtensionPanelProps } from "../../lib/extensions";
import { client, orpc } from "../../lib/rpc";
import { useSettings } from "../../lib/settings";
import modernDarkTheme from "../files/theme.json";

const highlighterPromise = createHighlighter({
  langs: [],
  themes: [modernDarkTheme as any],
});

interface DiffViewState {
  focusPath?: string;
}

interface StatusFile {
  path: string;
  index: string;
  working_dir: string;
}

type FileStageState = "staged" | "partial" | "unstaged";
type DiffViewMode = "split" | "unified";

const noFiles: StatusFile[] = [];

const hasStatus = (value: string) => value.trim() !== "";
const hasRealChange = (value: string) => hasStatus(value) && value !== "?";
const hasStagedChange = (file: StatusFile) => hasRealChange(file.index);
const hasWorktreeChange = (file: StatusFile) => hasStatus(file.working_dir);

function getChangedPaths(files: readonly StatusFile[]): string[] {
  return files
    .filter((file) => hasStagedChange(file) || hasWorktreeChange(file))
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
}

function getFileStageState(file: StatusFile | undefined): FileStageState {
  if (!file) {
    return "unstaged";
  }

  const staged = hasStagedChange(file);
  const unstaged = hasRealChange(file.working_dir);

  if (staged && !unstaged) {
    return "staged";
  }

  if (staged && unstaged) {
    return "partial";
  }

  return "unstaged";
}

function areSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    rs: "rust",
    py: "python",
    go: "go",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
  };
  return languageMap[ext] ?? "text";
}

function DiffFileView({
  mode,
  path,
  originalContent,
  modifiedContent,
}: {
  mode: DiffViewMode;
  path: string;
  originalContent: string;
  modifiedContent: string;
}) {
  const editorSettings = useSettings((cfg) => cfg.editor);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    let view: { destroy: () => void } | null = null;
    let disposed = false;

    (async () => {
      if (!containerRef.current) return;

      const highlighter = await highlighterPromise;
      const language = getLanguageFromPath(path);

      if (!highlighter.getLoadedLanguages().includes(language)) {
        try {
          await highlighter.loadLanguage(language as any);
        } catch {
          // Language not supported, fall back to plain text.
        }
      }

      const theme = highlighter.getTheme(modernDarkTheme.name);

      if (disposed) return;

      const sharedExtensions = [
        lineNumbers(),
        shiki({
          highlighter: highlighterPromise,
          language,
          theme: modernDarkTheme.name,
        }),
        drawSelection(),
        EditorView.darkTheme.of(theme.type === "dark"),
        EditorView.theme({
          "&": {
            backgroundColor: "transparent",
            outline: "none !important",
            color: theme.fg,
            fontFamily: `var(--editor-font-family,"JetBrains_Mono"), monospace`,
          },
          "&::selection": {
            backgroundColor: "transparent",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            paddingRight: "1ch",
            color: "rgba(255, 255, 255, 0.25)",
            border: "none",
            fontFamily: `var(--editor-font-family,"JetBrains_Mono"), monospace`,
            fontSize: `var(--editor-font-size,inherit)`,
          },
          ".cm-lineNumbers": {
            width: "auto",
            padding: "0",
            paddingLeft: "1ch",
          },
          ".cm-content": {
            fontFamily: `var(--editor-font-family,"JetBrains_Mono"), monospace`,
            fontSize: `var(--editor-font-size,inherit)`,
          },
          ".cm-mergeViewEditor, .cm-scroller": {
            maxHeight: "min(70vh, 860px)",
            overflow: "auto",
          },
          ".cm-merge-b": {
            background: "none",
          },
          ".cm-changedLine": {
            borderBottom: "none !important",
          },
          ".cm-insertedLine": {
            borderBottom: "none !important",
          },
          ".cm-deletedLine": {
            backgroundColor: "rgba(239, 68, 68, 0.15) !important",
            borderBottom: "none !important",
          },
          ".cm-changedText": {
            background: "rgba(16, 185, 129, 0.3) !important",
            borderBottom: "none !important",
          },
          ".cm-deletedText": {
            backgroundColor: "rgba(239, 68, 68, 0.3) !important",
          },
        }),
        EditorState.readOnly.of(true),
      ];

      if (mode === "split") {
        view = new MergeView({
          a: {
            doc: originalContent,
            extensions: sharedExtensions,
          },
          b: {
            doc: modifiedContent,
            extensions: sharedExtensions,
          },
          parent: containerRef.current,
          collapseUnchanged: { margin: 3, minSize: 4 },
          gutter: true,
        });
        return;
      }

      view = new EditorView({
        parent: containerRef.current,
        doc: modifiedContent,
        extensions: [
          ...sharedExtensions,
          unifiedMergeView({
            original: originalContent,
            collapseUnchanged: { margin: 3, minSize: 4 },
            gutter: true,
            highlightChanges: true,
          }),
        ],
      });
    })();

    return () => {
      view?.destroy();
      disposed = true;
    };
  }, [mode, modifiedContent, originalContent, path]);

  return (
    <div
      className="overflow-auto"
      ref={containerRef}
      style={
        {
          "--editor-font-family": editorSettings.fontFamily,
          "--editor-font-size": `${editorSettings.fontSize}px`,
        } as any
      }
    />
  );
}

export default function DiffViewPanel({ state, workspaceCwd }: ExtensionPanelProps<DiffViewState>) {
  const { focusPath } = state;

  const { data: gitStatus } = useSuspenseQuery(
    orpc.git.statusWatch.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const files = (gitStatus?.files ?? noFiles) as StatusFile[];
  const changedPaths = useMemo(() => getChangedPaths(files), [files]);

  const fileByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  const headResults = useSuspenseQueries({
    queries: changedPaths.map((path) =>
      orpc.git.show.queryOptions({
        queryKey: ["git", "show", "head", path],
        input: { action: "head", path },
      }),
    ),
  });

  const worktreeResults = useSuspenseQueries({
    queries: changedPaths.map((path) =>
      orpc.git.show.queryOptions({
        queryKey: ["git", "show", "worktree", path],
        input: { action: "worktree", path },
      }),
    ),
  });

  const changes = useMemo(
    () =>
      changedPaths.map((path, index) => ({
        path,
        stageState: getFileStageState(fileByPath.get(path)),
        originalContent: headResults[index]?.data?.content ?? "",
        modifiedContent: worktreeResults[index]?.data?.content ?? "",
      })),
    [changedPaths, fileByPath, headResults, worktreeResults],
  );

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>("split");
  const hasInitializedExpandedPathsRef = useRef(false);
  const previousFocusPathRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (changedPaths.length === 0) {
      hasInitializedExpandedPathsRef.current = false;
      previousFocusPathRef.current = focusPath;
      setExpandedPaths(new Set());
      return;
    }

    const focusChanged = previousFocusPathRef.current !== focusPath;
    previousFocusPathRef.current = focusPath;

    if (!hasInitializedExpandedPathsRef.current) {
      hasInitializedExpandedPathsRef.current = true;
      if (focusPath && changedPaths.includes(focusPath)) {
        setExpandedPaths(new Set([focusPath]));
        return;
      }
      const initialPath = changedPaths[0];
      setExpandedPaths(initialPath ? new Set([initialPath]) : new Set());
      return;
    }

    if (focusChanged && focusPath && changedPaths.includes(focusPath)) {
      setExpandedPaths(new Set([focusPath]));
      return;
    }

    const changedPathSet = new Set(changedPaths);
    setExpandedPaths((current) => {
      const next = new Set([...current].filter((path) => changedPathSet.has(path)));
      if (areSetsEqual(current, next)) {
        return current;
      }
      return next;
    });
  }, [changedPaths, focusPath]);

  const allExpanded = changedPaths.length > 0 && changedPaths.every((path) => expandedPaths.has(path));

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
    setExpandedPaths(() => (allExpanded ? new Set() : new Set(changedPaths)));
  }, [allExpanded, changedPaths]);

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

      await client.commands.run({
        command: "files.open",
        args: [`${workspaceCwd}/${path}`],
        cwd: workspaceCwd,
      });
    },
    [workspaceCwd],
  );

  if (changes.length === 0) {
    return <div className="flex size-full items-center justify-center text-sm text-white/45">No changes.</div>;
  }

  return (
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
            onClick={() => setDiffViewMode("unified")}
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
            onClick={() => setDiffViewMode("split")}
            title="Split diff view"
            aria-label="Split diff view"
            className={
              diffViewMode === "split"
                ? "rounded border border-cyan-400/50 bg-cyan-500/15 p-1.5 text-cyan-200"
                : "rounded border border-white/12 p-1.5 text-white/75 hover:bg-white/8 hover:text-white"
            }
          >
            <SquareSplitVertical className="size-3.5" />
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

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-2">
          {changes.map((change) => {
            const isExpanded = expandedPaths.has(change.path);

            return (
              <section key={change.path} className="overflow-hidden rounded-md border border-white/10 bg-black/20">
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
                    disabled={isStagingMutationPending}
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
                    <DiffFileView
                      mode={diffViewMode}
                      path={change.path}
                      originalContent={change.originalContent}
                      modifiedContent={change.modifiedContent}
                    />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
