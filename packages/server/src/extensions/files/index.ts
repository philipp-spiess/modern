import path from "node:path";
import { URI } from "vscode-uri";
import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";
import { saveFile } from "./shared";

export const id = "modern.files";

export default createExtension(async () => {
  const cwd = modern.project.cwd;
  if (!cwd) throw new Error("Project cwd is not available.");

  const disposables: Disposable[] = [];
  type PanelHandle = ReturnType<typeof modern.window.createReactPanel>;
  const editorPanels = new Map<string, PanelHandle>();

  const register = <T extends (...args: any[]) => unknown>(
    command: string,
    handler: T,
    options?: Parameters<typeof modern.commands.registerCommand>[2],
  ) => {
    disposables.push(modern.commands.registerCommand(command, handler, options));
  };

  const openDocument = (file: string) => {
    const uri = URI.file(file);
    const uriStr = uri.toString();
    let panel = editorPanels.get(uriStr);

    // If the previous panel was closed (disposed), drop the stale reference
    // so we create a fresh panel + tab below.
    if (panel?.disposed) {
      editorPanels.delete(uriStr);
      panel = undefined;
    }

    if (!panel) {
      const title = path.basename(uri.fsPath) || "Untitled";
      panel = modern.window.createReactPanel("files.editor", "files/editor.tsx", title);
      panel.state = { uri: uriStr };
      editorPanels.set(uriStr, panel);
    } else {
      // File is already open — the client will focus via the returned panelId.
      panel.title = path.basename(uri.fsPath) || panel.title;
      panel.state = { uri: uriStr };
    }
    return { uri: uriStr, panelId: panel.id };
  };

  register("files.open", (uri: string) => openDocument(uri));
  register("files.setDirty", (file: string, dirty: boolean) => {
    const uri = URI.parse(file);
    const panel = editorPanels.get(uri.toString());
    if (panel) {
      panel.closeOverlayIcon = dirty ? "circle" : undefined;
    }
  });
  register("files.save", (uri: string, content: string, mtime: number) => saveFile(uri, content, mtime), {
    defaultKeybinding: { key: "cmd+s", scope: "files.editor" },
  });

  register(
    "files.openWorkspace",
    async () => {
      // Client-side handled
    },
    {
      title: "File: Open Project…",
      defaultKeybinding: { key: "cmd+shift+o", scope: "global" },
    },
  );

  return createDisposable(() => {
    for (const panel of editorPanels.values()) {
      panel[Symbol.dispose]();
    }
    editorPanels.clear();
    return [...disposables];
  });
});

export type { LoadResult } from "./shared";
