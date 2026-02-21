import type { WorkspaceThreadSelection } from "@moderndev/server/src/state";
import { listen } from "@tauri-apps/api/event";
import { Menu, MenuItem, Submenu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useKeybinding } from "../lib/keybindings";
import { client, orpc } from "../lib/rpc";
import { useHandle } from "../lib/use-handle";
import { openWorkspace } from "../lib/workspace";
import CommandPalette from "./command-palette";
import Sidebar from "./sidebar";
import SplashScreen from "./splash-screen";
import WorkspaceShell from "./workspace-shell";

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
  const [isSplashVisible, setIsSplashVisible] = useState(false);
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
  const expandedByWorkspace = useMemo(
    () => workspaceData?.expandedByWorkspace ?? {},
    [workspaceData?.expandedByWorkspace],
  );
  const activeThread = useMemo(
    () => normalizeWorkspaceThreadSelection(workspaceData?.activeThread ?? null),
    [workspaceData?.activeThread],
  );

  const [mountedWorkspaces, setMountedWorkspaces] = useState<string[]>(() => (cwd ? [cwd] : []));
  const [workspaceThreads, setWorkspaceThreads] = useState<Record<string, WorkspaceThreadSelection | null>>({});

  useEffect(() => {
    if (!cwd) {
      return;
    }

    setMountedWorkspaces((current) => (current.includes(cwd) ? current : [...current, cwd]));
  }, [cwd]);

  useEffect(() => {
    if (!cwd) {
      return;
    }

    setWorkspaceThreads((current) => {
      const previous = current[cwd] ?? null;
      if (sameThreadSelection(previous, activeThread)) {
        return current;
      }

      return {
        ...current,
        [cwd]: activeThread,
      };
    });
  }, [cwd, activeThread]);

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
        <Sidebar
          activeCwd={cwd}
          activeThread={activeThread}
          workspaces={workspaces}
          expandedByWorkspace={expandedByWorkspace}
          onShowSplash={() => setIsSplashVisible(true)}
        />

        <div className="group relative h-full w-px select-none cursor-ew-resize">
          <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-px -translate-x-1/2 rounded bg-white/0 transition-all duration-150 ease-in-out group-hover:w-[3px] group-hover:bg-white/20 group-active:bg-white/20" />
          <div
            {...handleProps}
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            className="absolute -inset-x-2 inset-y-0 cursor-ew-resize touch-none"
          />
        </div>

        <div className="relative size-full overflow-hidden">
          {mountedWorkspaces.map((workspaceCwd) => {
            const active = workspaceCwd === cwd;
            return (
              <div
                key={workspaceCwd}
                aria-hidden={!active}
                className={active ? "absolute inset-0" : "absolute inset-0 pointer-events-none opacity-0"}
              >
                <WorkspaceShell
                  active={active}
                  workspaceCwd={workspaceCwd}
                  activeThread={workspaceThreads[workspaceCwd] ?? (active ? activeThread : null)}
                />
              </div>
            );
          })}
        </div>
      </main>

      {isSplashVisible ? <SplashScreen onClose={() => setIsSplashVisible(false)} /> : null}

      <CommandPalette cwd={cwd} />
    </div>
  );
}

function normalizeWorkspaceThreadSelection(
  selection: WorkspaceThreadSelection | null,
): WorkspaceThreadSelection | null {
  if (!selection) {
    return null;
  }

  const title = selection.title?.trim();

  if (selection.kind === "draft") {
    return {
      kind: "draft",
      ...(title ? { title } : {}),
    };
  }

  const threadPath = selection.threadPath?.trim();
  if (!threadPath) {
    return null;
  }

  return {
    kind: "existing",
    threadPath,
    ...(title ? { title } : {}),
  };
}

function sameThreadSelection(left: WorkspaceThreadSelection | null, right: WorkspaceThreadSelection | null): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "draft" && right.kind === "draft") {
    return (left.title ?? "") === (right.title ?? "");
  }

  if (left.kind === "existing" && right.kind === "existing") {
    return left.threadPath === right.threadPath && (left.title ?? "") === (right.title ?? "");
  }

  return false;
}

export default App;
