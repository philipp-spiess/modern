import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers, type KeyBinding } from "@codemirror/view";
import type { LoadResult } from "@moderndev/server/src/extensions/files";
import { useSuspenseQuery } from "@tanstack/react-query";
import shiki from "codemirror-shiki";
import { useLayoutEffect, useRef } from "react";
import { createHighlighter } from "shiki";
import { useSettings } from "../../lib/settings";
import { toCodemirrorShortcut, type Binding } from "../../lib/keybindings";
import { useKeybinding } from "../../lib/keybindings";
import { type ExtensionPanelProps } from "../../lib/extensions";
import { client, orpc } from "../../lib/rpc";
import modernDarkTheme from "./theme.json";

const highlighterPromise = createHighlighter({
  langs: [],
  themes: [modernDarkTheme as any],
});

export default function FileEditorPanel({ state }: ExtensionPanelProps<{ uri: string }>) {
  const { data } = useSuspenseQuery(
    orpc.files.load.queryOptions({
      queryKey: ["files", "load", state.uri],
      input: { uri: state.uri },
      context: { cache: true },
    }),
  ) as { data: LoadResult };

  const editorSettings = useSettings((cfg) => cfg.editor);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mtimeRef = useRef(data.mtime);
  const editorBindings = useKeybinding("files.editor") as Binding[];
  const isDirtyRef = useRef(false);

  useLayoutEffect(() => {
    let view: EditorView | null = null;
    let disposed = false;
    (async () => {
      if (!containerRef.current) return;

      async function saveDocument() {
        if (!view) return;
        let response = await client.files.save({
          uri: state.uri,
          content: view.state.doc.toString(),
          mtime: mtimeRef.current,
        });
        mtimeRef.current = response.mtime;
        void client.files.setDirty({ uri: state.uri, dirty: false });
        isDirtyRef.current = false;
      }

      let highlighter = await highlighterPromise;
      let language = languageIdToShikiLanguage(data.languageId);
      if (!highlighter.getLoadedLanguages().includes(language)) {
        await highlighter.loadLanguage(language as any);
      }
      let theme = highlighter.getTheme(modernDarkTheme.name);

      if (disposed) return;

      const commandHandlers: Record<string, (view: EditorView) => boolean> = {
        "files.save": () => {
          void saveDocument();
          return true;
        },
      };

      const shortcutKeymap = editorBindings
        .map((binding) => {
          const key = toCodemirrorShortcut(binding.key);
          if (!key) return null;
          const handler = commandHandlers[binding.command];
          const run = handler
            ? (editorView: EditorView) => handler(editorView)
            : () => {
                void client.commands.run({ command: binding.command });
                return true;
              };
          return { key, preventDefault: true, run };
        })
        .filter(Boolean) as Array<{ key: string; preventDefault: boolean; run: (view: EditorView) => boolean }>;

      const toViewKeymap = (bindings: readonly unknown[]): readonly KeyBinding[] =>
        bindings as unknown as readonly KeyBinding[];

      view = new EditorView({
        state: EditorState.create({
          doc: data.content,
          extensions: [
            history(),
            keymap.of(toViewKeymap([indentWithTab])),
            keymap.of(toViewKeymap(shortcutKeymap)),
            keymap.of(toViewKeymap(historyKeymap)),
            keymap.of(toViewKeymap(defaultKeymap)),
            lineNumbers(),
            shiki({
              highlighter: highlighterPromise,
              language,
              theme: modernDarkTheme.name,
            }),
            drawSelection(),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !isDirtyRef.current) {
                isDirtyRef.current = true;
                void client.files.setDirty({ uri: state.uri, dirty: true });
              }
            }),
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
            }),
          ],
        }),
        parent: containerRef.current,
      });

      view.focus();
    })();

    return () => {
      view?.destroy?.();
      disposed = true;
    };
  }, [data.content, data.languageId, editorBindings, state.uri]);

  return (
    <div
      className="size-full overflow-auto pr-4"
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

function languageIdToShikiLanguage(languageId: string): string {
  switch (languageId) {
    case "typescriptreact":
      return "tsx";
    default:
      return languageId;
  }
}
