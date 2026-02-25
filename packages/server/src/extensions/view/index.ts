import { createExtension, modern, executeCommand } from "../../extension";
import { createDisposable } from "../../utils/disposable";
import { ensureSettingsFile } from "../../settings";

export const id = "modern.view";

const defaultKeybindings: ReadonlyArray<{
  command: string;
  defaultKeybinding: { key: string; scope: "view.command-palette" | "view.tabs" };
}> = [
  {
    command: "view.command-palette.open-files",
    defaultKeybinding: { key: "cmd+p", scope: "view.command-palette" },
  },
  {
    command: "view.command-palette.open-commands",
    defaultKeybinding: { key: "shift+cmd+p", scope: "view.command-palette" },
  },
  {
    command: "view.tabs.close",
    defaultKeybinding: { key: "cmd+w", scope: "view.tabs" },
  },
];

export default createExtension(() => {
  const disposables: Disposable[] = [];

  disposables.push(
    modern.commands.registerCommand(
      "settings.open",
      async () => {
        const settingsPath = await ensureSettingsFile();
        await executeCommand("files.open", settingsPath);
      },
      { title: "Open Settings", defaultKeybinding: { key: "cmd+,", scope: "global" } },
    ),
  );

  disposables.push(
    modern.commands.registerCommand(
      "view.splash.open",
      () => {
        // Implemented in the client
      },
      { title: "Show Welcome" },
    ),
  );

  disposables.push(
    modern.commands.registerCommand(
      "workspace.newThread",
      () => {
        // Implemented in the client
      },
      { title: "New Thread", defaultKeybinding: { key: "cmd+n", scope: "global" } },
    ),
  );

  disposables.push(
    modern.commands.registerCommand(
      "view.toggleSidebar",
      () => {
        // Implemented in the client
      },
      { title: "Toggle Sidebar", defaultKeybinding: { key: "cmd+b", scope: "global" } },
    ),
  );

  disposables.push(
    modern.commands.registerCommand(
      "view.toggleDevTools",
      () => {
        // Implemented in the client
      },
      { title: "Toggle Developer Tools" },
    ),
  );

  disposables.push(
    modern.commands.registerCommand(
      "app.restart-server",
      () => {
        process.exit(0);
      },
      { title: "Restart App Server" },
    ),
  );

  for (const binding of defaultKeybindings) {
    disposables.push(
      modern.commands.registerCommand(
        binding.command,
        () => {
          // Implemented in the client
        },
        { defaultKeybinding: binding.defaultKeybinding },
      ),
    );
  }

  return createDisposable(() => disposables);
});
