import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, lineNumbers } from "@codemirror/view";
import { useSuspenseQuery } from "@tanstack/react-query";
import shiki from "codemirror-shiki";
import { useLayoutEffect, useRef } from "react";
import { createHighlighter } from "shiki";
import type { ExtensionPanelProps } from "../../lib/extensions";
import { orpc } from "../../lib/rpc";
import { useSettings } from "../../lib/settings";
import modernDarkTheme from "../files/theme.json";

const highlighterPromise = createHighlighter({
  langs: [],
  themes: [modernDarkTheme as any],
});

type DiffMode = "staged" | "worktree";

interface DiffViewState {
  path: string;
  mode: DiffMode;
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

export default function DiffViewPanel({ state }: ExtensionPanelProps<DiffViewState>) {
  const { path, mode } = state;

  const { data: headData } = useSuspenseQuery(
    orpc.git.show.queryOptions({
      queryKey: ["git", "show", "head", path],
      input: { action: "head", path },
    }),
  );

  const { data: currentData } = useSuspenseQuery(
    mode === "staged"
      ? orpc.git.show.queryOptions({
          queryKey: ["git", "show", "staged", path],
          input: { action: "staged", path },
        })
      : orpc.git.show.queryOptions({
          queryKey: ["git", "show", "worktree", path],
          input: { action: "worktree", path },
        }),
  );

  const editorSettings = useSettings((cfg) => cfg.editor);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const originalContent = headData?.content ?? "";
  const modifiedContent = currentData?.content ?? "";

  useLayoutEffect(() => {
    let view: MergeView | null = null;
    let disposed = false;

    (async () => {
      if (!containerRef.current) return;

      const highlighter = await highlighterPromise;
      const language = getLanguageFromPath(path);

      if (!highlighter.getLoadedLanguages().includes(language)) {
        try {
          await highlighter.loadLanguage(language as any);
        } catch {
          // Language not supported, fall back to plain text
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
          ".cm-mergeView": {
            height: "100%",
          },
          ".cm-mergeViewEditors": {
            height: "100%",
          },
          ".cm-mergeViewEditor": {
            height: "100%",
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
    })();

    return () => {
      view?.destroy();
      disposed = true;
    };
  }, [originalContent, modifiedContent, path]);

  return (
    <div
      className="size-full overflow-auto"
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
