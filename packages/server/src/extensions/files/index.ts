import path from "node:path";
import { URI } from "vscode-uri";
import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";
import { saveFile } from "./shared";

export const id = "modern.files";

export default createExtension(async () => {
  const cwd = modern.workspace.cwd;
  if (!cwd) throw new Error("Workspace cwd is not available.");

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
    let panel = editorPanels.get(uri.toString());
    if (!panel) {
      const title = path.basename(uri.fsPath) || "Untitled";
      panel = modern.window.createReactPanel("files.editor", "files/editor.tsx", title);
      panel.state = { uri: uri.toString() };
      editorPanels.set(uri.toString(), panel);
    } else {
      panel.title = path.basename(uri.fsPath) || panel.title;
      panel.state = { uri: uri.toString() };
    }
    return { uri: uri.toString() };
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
      title: "File: Open Workspace…",
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
