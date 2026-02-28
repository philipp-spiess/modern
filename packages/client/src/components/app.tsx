import type { WorkspaceThreadSelection } from "@moderndev/server/src/state";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Menu, MenuItem, Submenu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useKeybinding } from "../lib/keybindings";
import { openProject, openProjectWithNewThread } from "../lib/project";
import { client, orpc } from "../lib/rpc";
import { restartApp } from "../lib/restart-app";
import { toggleSidebar, useSidebarVisible } from "../lib/sidebar-store";
import { useHandle } from "../lib/use-handle";
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
          text: "Open Project…",
          accelerator: "CmdOrCtrl+Shift+O",
          action: () => {
            void openProject();
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
  const sidebarVisible = useSidebarVisible();
  const layoutStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    const unlisten = listen("open-workspace", () => {
      void openProject();
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const showSplash = useCallback(() => setIsSplashVisible(true), []);

  useKeybinding("global", async (command) => {
    if (command === "files.openWorkspace") {
      await openProject();
      return;
    }
    if (command === "view.splash.open") {
      showSplash();
      return;
    }
    if (command === "project.newThread") {
      if (cwd) {
        await openProjectWithNewThread(cwd);
      }
      return;
    }
    if (command === "view.toggleSidebar") {
      toggleSidebar();
      return;
    }
    if (command === "view.toggleDevTools") {
      void invoke("toggle_devtools");
      return;
    }
    if (command === "app.restart-server") {
      await restartApp();
      return;
    }
    await client.commands.run({ command });
  });

  // Get the current project from the server
  const { data: workspaceData } = useSuspenseQuery(
    orpc.project.current.queryOptions({
      queryKey: ["project", "current"],
    }),
  );

  const cwd = workspaceData?.cwd;
  const activeProjectCwd = workspaceData?.projectCwd ?? cwd;
  const projects = workspaceData?.projects ?? [];
  const expandedByProject = useMemo(() => workspaceData?.expandedByProject ?? {}, [workspaceData?.expandedByProject]);
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

  if (!cwd) {
    return <SplashScreen onClose={() => {}} />;
  }

  return (
    <div className="flex h-dvh w-full flex-col">
      <main
        style={layoutStyle}
        className={
          sidebarVisible
            ? "grid flex-1 grid-cols-[minmax(120px,var(--sidebar-width))_auto_1fr] overflow-hidden"
            : "flex flex-1 overflow-hidden"
        }
      >
        {sidebarVisible && (
          <>
            <Sidebar
              activeCwd={activeProjectCwd ?? cwd}
              activeThread={activeThread}
              projects={projects}
              expandedByProject={expandedByProject}
            />

            <div className="group relative h-full w-px select-none cursor-col-resize">
              <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-px -translate-x-1/2 rounded bg-gradient-to-b from-transparent via-white/0 to-transparent transition-all duration-150 ease-in-out group-hover:w-[3px] group-hover:via-white/20 group-active:via-white/20" />
              <div
                {...handleProps}
                role="separator"
                aria-label="Resize sidebar"
                aria-orientation="vertical"
                className="absolute -inset-x-2 inset-y-0 cursor-col-resize touch-none"
              />
            </div>
          </>
        )}

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

      <CommandPalette cwd={cwd} onShowSplash={showSplash} />
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
