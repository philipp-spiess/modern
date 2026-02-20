import { listen } from "@tauri-apps/api/event";
import { Menu, MenuItem, Submenu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useKeybinding } from "../lib/keybindings";
import { client, orpc } from "../lib/rpc";
import { useHandle } from "../lib/use-handle";
import { openWorkspace } from "../lib/workspace";
import CommandPalette from "./command-palette";
import Sidebar from "./sidebar";
import { Tabs } from "./tabs";

const setupMenu = async () => {
  // Find the "File" submenu if it exists, or create one if not.
  // For cross-platform compatibility, it's safer to ensure its existence.
  let menu = await Menu.default();
  for (let item of await menu.items()) {
    if (item instanceof Submenu) {
      if ((await item.text()) === "File") {
        const openWorkspaceMenuItem = await MenuItem.new({
          text: "Open Workspace…",
          accelerator: "CmdOrCtrl+Shift+O",
          action: () => {
            void openWorkspace();
          },
        });
        await item.prepend(
          await PredefinedMenuItem.new({
            text: "separator-text",
            item: "Separator",
          }),
        );
        await item.prepend(openWorkspaceMenuItem);

        await menu.setAsAppMenu();
      }
    }
  }
};
void setupMenu();

function App() {
  const [sidebarWidth, handleProps] = useHandle("horizontal", "sidebar-width", 320);
  const layoutStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    const unlisten = listen("open-workspace", () => {
      void openWorkspace();
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useKeybinding("global", async (command) => {
    if (command === "files.openWorkspace") {
      await openWorkspace();
      return;
    }
    await client.commands.run({ command });
  });

  // Get the current workspace from the server
  const { data: workspaceData } = useSuspenseQuery(
    orpc.workspace.cwd.queryOptions({
      queryKey: ["workspace", "cwd"],
    }),
  );

  const cwd = workspaceData?.cwd;
  const workspaces = workspaceData?.workspaces ?? [];
  const [mountedWorkspaces, setMountedWorkspaces] = useState<string[]>(() => (cwd ? [cwd] : []));

  if (cwd && !mountedWorkspaces.includes(cwd)) {
    setMountedWorkspaces((current) => (current.includes(cwd) ? current : [...current, cwd]));
  }

  // TODO: Show a nice empty state / welcome screen
  if (!cwd) {
    return null;
  }

  return (
    <div className="flex h-dvh w-full flex-col">
      <main
        style={layoutStyle}
        className="grid flex-1 grid-cols-[minmax(120px,var(--sidebar-width))_auto_1fr] overflow-hidden"
      >
        <Sidebar activeCwd={cwd} workspaces={workspaces} />

        <div className="group relative h-full w-px select-none">
          <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-px -translate-x-1/2 rounded bg-white/0 transition-all duration-150 ease-in-out group-hover:w-[3px] group-hover:bg-white/20 group-active:bg-white/20" />
          <div
            {...handleProps}
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            className="absolute -inset-x-2 inset-y-0 cursor-ew-resize"
          />
        </div>

        <div className="flex flex-col overflow-hidden size-full relative">
          {mountedWorkspaces.map((workspaceCwd) => {
            const active = workspaceCwd === cwd;
            return (
              <div
                key={workspaceCwd}
                aria-hidden={!active}
                className={active ? "absolute inset-0" : "absolute inset-0 pointer-events-none opacity-0"}
              >
                <Tabs active={active} workspaceCwd={workspaceCwd} />
              </div>
            );
          })}
        </div>
      </main>

      <CommandPalette cwd={cwd} />
    </div>
  );
}

export default App;
