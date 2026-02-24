/**
 * SnippetPlugin – automatically collapses large pastes into SnippetNodes.
 *
 * Listens for paste events on the Lexical editor.  When the pasted text
 * exceeds the threshold (>10 lines or >1 000 chars – same as pi's TUI),
 * instead of inserting the raw text it inserts a collapsed SnippetNode chip.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTextNode, $getSelection, $isRangeSelection, COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from "lexical";
import { useEffect } from "react";
import { $createSnippetNode, shouldCollapseToSnippet } from "./snippet-node";

export function SnippetPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text || !shouldCollapseToSnippet(text)) {
          // Let the default paste handler deal with small pastes
          return false;
        }

        event.preventDefault();

        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          // Delete any selected text first
          selection.removeText();

          // Ensure there's a space before the snippet
          const anchorNode = selection.anchor.getNode();
          if (anchorNode.getTextContent().length > 0) {
            const textBefore = anchorNode.getTextContent();
            const charBefore = textBefore[selection.anchor.offset - 1];
            if (charBefore && charBefore !== " " && charBefore !== "\n") {
              selection.insertText(" ");
            }
          }

          const snippetNode = $createSnippetNode(text);

          // Insert the snippet node
          selection.insertNodes([snippetNode]);

          // Add a trailing space so the cursor has somewhere to go
          const trailingText = $createTextNode(" ");
          snippetNode.insertAfter(trailingText);
          trailingText.select();
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}
