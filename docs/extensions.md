# Modern Extension API

This page documents the extension runtime in `packages/server/src/extension.ts`.

> The API is currently internal to this repository and may change.

## Runtime model

- Extensions are activated **per project**.
- Define extensions with `createExtension(...)`.
- Use `modern` for runtime APIs: `commands`, `window`, `project`, `workspace`, `storage`.
- Accessing `modern` outside an active extension context throws.

---

## Minimal extension

```ts
// packages/server/src/extensions/hello/index.ts
import { createExtension, modern } from "../../extension";
import { createDisposable } from "../../utils/disposable";

export const id = "modern.hello";

export default createExtension(() => {
  const disposables: Disposable[] = [];

  disposables.push(
    modern.commands.registerCommand("hello.sayHello", (name = "world") => `Hello ${name}`, {
      title: "Hello: Say Hello",
      defaultKeybinding: { key: "cmd+shift+h", scope: "global" },
    }),
  );

  return createDisposable(() => disposables);
});
```

### Register extension activation

Add it to `packages/server/src/state.ts`:

```ts
import helloExtension, { id as helloExtensionId } from "./extensions/hello";

const extensionEntries = [
  // ...existing entries
  { extension: helloExtension, id: helloExtensionId },
] as const;
```

### Optional: show a React panel

```ts
const panel = modern.window.createReactPanel("hello.panel", "hello/panel.tsx", "Hello", "rocket");
panel.state = { message: "Welcome" };
```

`module` paths are resolved by the client tab loader (`packages/client/src/components/tabs.tsx`).
To render this panel, add:

```ts
const moduleImports: Record<string, () => Promise<any>> = {
  // ...existing modules
  "hello/panel.tsx": () => import("../extensions/hello/panel.tsx"),
};
```

---

## API quick reference

### `createExtension(activate)`

Creates an extension module.

- `activate` runs inside an extension context.
- `activate` currently receives no arguments.
- It can return `void`, a `Disposable`, or a promise of either.
- Returned disposables run when the workspace session is torn down.

### `modern.commands`

#### `registerCommand(command, callback, options?) => Disposable`

Registers a command scoped to current extension + workspace.

Options:

- `title?: string`
- `defaultKeybinding?: { key: string; scope?: "global" | "view.command-palette" | "view.tabs" | "files.editor" }`

Notes:

- `command` must be a non-empty string.
- The same command id cannot be owned by different extensions.
- Disposing unregisters the command for the current project.

### `modern.window`

#### `createReactPanel(viewType, module, title, icon?, iconColor?) => PanelHandle`

Creates a tab/panel in the current project.

`PanelHandle`:

- readonly: `id`, `viewType`, `module`, `disposed`
- mutable: `title`, `icon`, `iconColor`, `closeOverlayIcon`, `state`
- disposable via `panel[Symbol.dispose]()`

Updating mutable fields syncs panel state to the UI.

### `modern.project`

- `cwd: string` — resolved project root path.
- `registerWorkspaceProvider(provider)` — registers a workspace provider for this project.

### `modern.workspace`

- `cwd: string` — resolved execution workspace path.
- `openTextDocument(uriOrPath)` — reads a file and returns `TextDocumentHandle`.

`TextDocumentHandle`:

- `uri`, `fileName`, `languageId`, `isDirty`
- `getText(range?)`
- `save()`

`range` uses 0-based `{ line, character }` positions.

### `modern.storage`

Project + extension scoped key/value store:

- `keys()`
- `get<T>(key, defaultValue?)`
- `set<T>(key, value)`

Data is isolated per extension/project pair.

### Host-side helpers (outside `modern`)

Used by the server router/runtime:

- `executeCommand(command, ...args)`
- `executeCommandForWorkspace(cwd, command, ...args)`
- `listRegisteredCommands()`

---

## Tiny examples

### Command with title + keybinding

```ts
modern.commands.registerCommand(
  "terminal.new",
  () => {
    // ...create terminal
  },
  {
    title: "Terminal: New Terminal",
    defaultKeybinding: { key: "cmd+t", scope: "global" },
  },
);
```

### Reuse one panel per resource

```ts
const panels = new Map<string, ReturnType<typeof modern.window.createReactPanel>>();

function openThread(threadPath: string) {
  let panel = panels.get(threadPath);

  if (panel?.disposed) {
    panels.delete(threadPath);
    panel = undefined;
  }

  if (!panel) {
    panel = modern.window.createReactPanel("agent.chat", "agent/chat.tsx", "Thread", "message-square");
    panels.set(threadPath, panel);
  }

  panel.state = { threadPath };
  return panel.id;
}
```

### Persist project-local state

```ts
const visits = modern.storage.get<number>("visits", 0) ?? 0;
await modern.storage.set("visits", visits + 1);
```

### Read part of a file

```ts
const doc = await modern.workspace.openTextDocument("README.md");
const preview = doc.getText({
  start: { line: 0, character: 0 },
  end: { line: 10, character: 0 },
});
```

For production usage, see:

- `packages/server/src/extensions/files/index.ts`
- `packages/server/src/extensions/agent/index.ts`
- `packages/server/src/extensions/review/index.ts`
- `packages/server/src/extensions/terminal/index.ts`
