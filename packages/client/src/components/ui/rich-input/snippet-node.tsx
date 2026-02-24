/**
 * SnippetNode – an inline, non-editable "chip" that represents a large
 * block of pasted / inserted text.  It renders as a small pill showing a
 * preview and expands on click so the user can verify the content.
 *
 * The full text is stored inside the node and will be serialised back into
 * the final message string when the editor content is read out.
 */

import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import type { JSX } from "react";
import { $applyNodeReplacement, DecoratorNode } from "lexical";

let pasteCounter = 0;
export function nextPasteId(): number {
  return ++pasteCounter;
}

// ---------------------------------------------------------------------------
// Thresholds – mirrors pi's TUI behaviour:
//   > 10 lines  OR  > 1 000 chars  →  collapse into a snippet chip
// ---------------------------------------------------------------------------
export const SNIPPET_LINE_THRESHOLD = 10;
export const SNIPPET_CHAR_THRESHOLD = 1_000;

export function shouldCollapseToSnippet(text: string): boolean {
  const lines = text.split("\n").length;
  return lines > SNIPPET_LINE_THRESHOLD || text.length > SNIPPET_CHAR_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Serialised shape (JSON)
// ---------------------------------------------------------------------------
export type SerializedSnippetNode = Spread<
  {
    text: string;
    label: string;
  },
  SerializedLexicalNode
>;

// ---------------------------------------------------------------------------
// The Lexical node
// ---------------------------------------------------------------------------
export class SnippetNode extends DecoratorNode<JSX.Element> {
  __text: string;
  __label: string;

  static getType(): string {
    return "snippet";
  }

  static clone(node: SnippetNode): SnippetNode {
    return new SnippetNode(node.__text, node.__label, node.__key);
  }

  constructor(text: string, label?: string, key?: NodeKey) {
    super(key);
    this.__text = text;
    if (label) {
      this.__label = label;
    } else {
      const id = nextPasteId();
      const lines = text.split("\n").length;
      this.__label =
        lines > SNIPPET_LINE_THRESHOLD ? `paste #${id} +${lines} lines` : `paste #${id} ${text.length} chars`;
    }
  }

  // --- Serialisation -------------------------------------------------------

  static importJSON(serializedNode: SerializedSnippetNode): SnippetNode {
    return $createSnippetNode(serializedNode.text, serializedNode.label);
  }

  exportJSON(): SerializedSnippetNode {
    return {
      type: "snippet",
      version: 1,
      text: this.__text,
      label: this.__label,
    };
  }

  // --- DOM -----------------------------------------------------------------

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    return span;
  }

  updateDOM(): false {
    return false;
  }

  // Inline, atomic (non-editable from the text-editing perspective)
  isInline(): boolean {
    return true;
  }

  // --- Decorator (React) ---------------------------------------------------

  decorate(): JSX.Element {
    return <SnippetChip text={this.__text} label={this.__label} nodeKey={this.__key} />;
  }

  // --- Getters -------------------------------------------------------------

  getText(): string {
    return this.__text;
  }
}

// ---------------------------------------------------------------------------
// Helper to create & register the node
// ---------------------------------------------------------------------------
export function $createSnippetNode(text: string, label?: string): SnippetNode {
  return $applyNodeReplacement(new SnippetNode(text, label));
}

export function $isSnippetNode(node: LexicalNode | null | undefined): node is SnippetNode {
  return node instanceof SnippetNode;
}

// ---------------------------------------------------------------------------
// React chip component rendered by the DecoratorNode
// ---------------------------------------------------------------------------
function SnippetChip({ label }: { text: string; label: string; nodeKey: NodeKey }) {
  return (
    <span className="rounded-sm bg-white/10 px-1 -my-px py-px text-muted-foreground" contentEditable={false}>
      {label}
    </span>
  );
}
