/**
 * RichInput – a Lexical-based input that supports inline snippet chips.
 *
 * Drop-in replacement for a <textarea> in the chat input.  It renders as a
 * plain-text editor (no formatting toolbar) with support for:
 *   - Large-paste auto-collapse into snippet chips
 *   - Programmatic snippet insertion (via ref)
 *   - Reading the full text back out (with snippets expanded)
 */

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { cn } from "@/lib/utils";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { $createSnippetNode, $isSnippetNode, SnippetNode } from "./snippet-node";
import { SnippetPlugin } from "./snippet-plugin";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RichInputHandle {
  /** Get the full message text with snippet contents expanded inline. */
  getText: () => string;
  /** Clear the editor. */
  clear: () => void;
  /** Focus the editor. */
  focus: () => void;
  /** Programmatically insert a snippet chip at the cursor. */
  insertSnippet: (text: string, label?: string) => void;
  /** Get the underlying Lexical editor instance. */
  getEditor: () => LexicalEditor | null;
}

export interface RichInputProps {
  /** Placeholder text. */
  placeholder?: string;
  /** Called on every change with a boolean indicating whether there is non-empty content. */
  onChange?: (hasContent: boolean) => void;
  /** Called on Enter (without Shift). Return `true` to prevent default. */
  onEnter?: () => boolean;
  /** Additional className for the content-editable area. */
  className?: string;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
  /** Additional keyboard handler */
  onKeyDown?: (e: KeyboardEvent) => void;
}

// ---------------------------------------------------------------------------
// Lexical theme (minimal – we only style the editor root, not formatting)
// ---------------------------------------------------------------------------
const theme = {
  // Prevent any default rich-text classes
  paragraph: "m-0",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk the editor tree and serialise all nodes into a single string. */
function $getFullText(): string {
  const root = $getRoot();
  const parts: string[] = [];

  for (const child of root.getChildren()) {
    const lineSegments: string[] = [];
    if ("getChildren" in child && typeof child.getChildren === "function") {
      for (const inline of (child as any).getChildren()) {
        if ($isSnippetNode(inline)) {
          lineSegments.push(inline.getText());
        } else if ("getTextContent" in inline) {
          lineSegments.push((inline as any).getTextContent());
        }
      }
    } else {
      lineSegments.push(child.getTextContent());
    }
    parts.push(lineSegments.join(""));
  }

  return parts.join("\n");
}

function $isEmpty(): boolean {
  const root = $getRoot();
  const text = root.getTextContent().trim();
  if (text.length > 0) return false;

  // Check for decorator nodes (snippets)
  for (const child of root.getChildren()) {
    if ("getChildren" in child && typeof child.getChildren === "function") {
      for (const inline of (child as any).getChildren()) {
        if ($isSnippetNode(inline)) return false;
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RichInput = forwardRef<RichInputHandle, RichInputProps>(function RichInput(
  { placeholder, onChange, onEnter, className, autoFocus, onKeyDown },
  ref,
) {
  const editorRef = useRef<LexicalEditor | null>(null);

  // Expose imperative handle
  useImperativeHandle(
    ref,
    () => ({
      getText() {
        let result = "";
        editorRef.current?.getEditorState().read(() => {
          result = $getFullText();
        });
        return result;
      },

      clear() {
        editorRef.current?.update(() => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          root.append(p);
          p.select();
        });
      },

      focus() {
        editorRef.current?.focus();
      },

      insertSnippet(text: string, label?: string) {
        editorRef.current?.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          // Ensure there's a space before the snippet
          const anchorNode = selection.anchor.getNode();
          const textBefore = anchorNode.getTextContent();
          const charBefore = textBefore[selection.anchor.offset - 1];
          if (charBefore && charBefore !== " " && charBefore !== "\n") {
            selection.insertText(" ");
          }

          const snippet = $createSnippetNode(text, label);
          selection.insertNodes([snippet]);

          const trailing = $createTextNode(" ");
          snippet.insertAfter(trailing);
          trailing.select();
        });
      },

      getEditor() {
        return editorRef.current;
      },
    }),
    [],
  );

  // Capture the editor instance
  const onEditorRef = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
  }, []);

  const handleChange = useCallback(
    (_editorState: EditorState, editor: LexicalEditor) => {
      if (!onChange) return;
      editor.getEditorState().read(() => {
        onChange(!$isEmpty());
      });
    },
    [onChange],
  );

  const initialConfig = {
    namespace: "RichInput",
    theme,
    nodes: [SnippetNode],
    onError: (error: Error) => console.error("[RichInput]", error),
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorRefPlugin onRef={onEditorRef} />
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            data-slot="input-group-control"
            className={cn(
              "relative w-full resize-none rounded-none border-0 bg-transparent py-3 px-3 text-base shadow-none outline-none md:text-sm",
              "[&_p]:m-0",
              className,
            )}
            aria-placeholder={placeholder ?? ""}
            placeholder={
              <div className="pointer-events-none absolute inset-0 select-none px-3 py-3 text-base text-muted-foreground md:text-sm">
                {placeholder ?? ""}
              </div>
            }
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <SnippetPlugin />
      <OnChangePlugin onChange={handleChange} />
      {onEnter && <EnterKeyPlugin onEnter={onEnter} />}
      {onKeyDown && <KeyDownPlugin onKeyDown={onKeyDown} />}
      {autoFocus && <AutoFocusPlugin />}
    </LexicalComposer>
  );
});

// ---------------------------------------------------------------------------
// Tiny internal plugins
// ---------------------------------------------------------------------------

/** Captures the editor ref after composition. */
function EditorRefPlugin({ onRef }: { onRef: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onRef(editor), [editor, onRef]);
  return null;
}

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

/** Intercepts Enter (without Shift) so the parent can handle send. */
function EnterKeyPlugin({ onEnter }: { onEnter: () => boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event?.shiftKey) return false;

        const handled = onEnter();
        if (handled) {
          event?.preventDefault();
          event?.stopImmediatePropagation();
        }

        return handled;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onEnter]);
  return null;
}

/** Forwards raw keydown events to the parent. */
function KeyDownPlugin({ onKeyDown }: { onKeyDown: (e: KeyboardEvent) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;
    rootElement.addEventListener("keydown", onKeyDown);
    return () => rootElement.removeEventListener("keydown", onKeyDown);
  }, [editor, onKeyDown]);
  return null;
}

/** Auto-focus on mount. Delays slightly to ensure the DOM is ready. */
function AutoFocusPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    // Small delay to ensure the editor root element is mounted
    const timer = setTimeout(() => editor.focus(), 0);
    return () => clearTimeout(timer);
  }, [editor]);
  return null;
}
