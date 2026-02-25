import type { Panel, Tabs as TabsType } from "@moderndev/server/src/state";
import { useQuery } from "@tanstack/react-query";
import { DockviewReact, type DockviewReadyEvent } from "dockview";
import { Loader2Icon, XIcon } from "lucide-react";
import { DynamicIcon } from "lucide-react/dynamic";
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useKeybinding } from "../lib/keybindings";
import { client, orpc } from "../lib/rpc";
import { focusPanelContent, onFocusPanel } from "../lib/tab-focus";

import "dockview/dist/styles/dockview.css";

const emptyTabs: TabsType = { groups: [] };
const emptyPanels: Panel[] = [];

const moduleCache = new Map<string, any>();

const moduleImports: Record<string, () => Promise<any>> = {
  "terminal/panel.tsx": () => import("../extensions/terminal/panel.tsx"),
  "agent/chat.tsx": () => import("../extensions/agent/chat.tsx"),
  "review/diff-view.tsx": () => import("../extensions/review/diff-view.tsx"),
  "files/editor.tsx": () => import("../extensions/files/editor.tsx"),
};

function loadModule(modulePath: string): any {
  if (!moduleCache.has(modulePath)) {
    const loader = moduleImports[modulePath];
    if (!loader) {
      console.error(`[tabs] Unknown extension module: ${modulePath}`);
      return () => null;
    }
    const LazyComponent = lazy(loader);
    moduleCache.set(modulePath, LazyComponent);
  }
  return moduleCache.get(modulePath)!;
}

const PanelLoading = () => (
  <div className="flex size-full items-center justify-center">
    <div className="flex items-center gap-2 text-sm text-white/40">
      <Loader2Icon className="animate-spin size-4" />
      <span>Loading…</span>
    </div>
  </div>
);

const PanelComponent = ({ params }: { params: Panel }) => {
  const Component = loadModule(params.module);
  return (
    <Suspense fallback={<PanelLoading />}>
      <Component {...params} />
    </Suspense>
  );
};

const CustomTabHeader = ({ api }: any) => {
  const params = api.getParameters() as Panel | undefined;
  const icon = params?.icon;
  const iconColor = params?.iconColor;
  const closeOverlayIcon = params?.closeOverlayIcon;

  const onMiddleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
  }, []);

  const onAuxClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 1) {
        return;
      }

      event.preventDefault();
      api.close();
    },
    [api],
  );

  const onClose = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      api.close();
    },
    [api],
  );

  return (
    <div
      onMouseDown={onMiddleMouseDown}
      onAuxClick={onAuxClick}
      className="flex items-center h-full group outline-none after:bg-transparent!"
    >
      <div className="h-7 flex px-1 items-center rounded-md in-[.dv-active-tab]:bg-white/2">
        {icon ? (
          <span className="pl-1">
            <DynamicIcon name={icon as any} strokeWidth={2.5} color={iconColor ?? "currentColor"} size={3 * 4} />
          </span>
        ) : null}
        <span className="pl-1 select-none">{api.title}</span>
        <div className="ml-1 relative">
          <div
            onClick={onClose}
            className="invisible group-hover:visible in-[.dv-active-tab]:visible hover:bg-white/5 rounded p-0.5"
          >
            <XIcon className="size-3.5 text-white/80" strokeWidth={2.5} />
          </div>

          {closeOverlayIcon ? (
            <div className="absolute inset-0 flex items-center justify-center group-hover:hidden pointer-events-none">
              <DynamicIcon
                name={closeOverlayIcon as any}
                className="size-2.5 text-white/80"
                strokeWidth={2.5}
                fill="currentColor"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const components = {
  panel: PanelComponent,
};

const tabComponents = {
  default: CustomTabHeader,
};

type TabsProps = {
  active: boolean;
  workspaceCwd: string;
  onHasOpenTabsChange?: (hasOpenTabs: boolean) => void;
};

function cloneTabs(tabs: TabsType): TabsType {
  return {
    groups: tabs.groups.map((group) => ({
      ...group,
      tabs: group.tabs.map((tab) => ({ ...tab })),
    })),
  };
}

function clonePanels(panels: readonly Panel[]): Panel[] {
  return panels.map((panel) => ({
    ...panel,
    state: structuredClone(panel.state),
  }));
}

function removeTab(tabs: TabsType, tabId: string): TabsType {
  return {
    groups: tabs.groups
      .map((group) => ({
        ...group,
        tabs: group.tabs.filter((tab) => tab.id !== tabId),
      }))
      .filter((group) => group.tabs.length > 0),
  };
}

function TabsComponent({ active, workspaceCwd, onHasOpenTabsChange }: TabsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<DockviewReadyEvent["api"] | null>(null);
  const [tabsData, setTabsData] = useState<TabsType>(emptyTabs);
  const [panelsData, setPanelsData] = useState<Panel[]>(emptyPanels);

  const tabsQuery = useQuery({
    ...orpc.tabs.watch.experimental_liveOptions({
      input: { cwd: workspaceCwd },
      context: { cache: true },
      retry: true,
    }),
    queryKey: ["tabs", "watch", workspaceCwd],
    enabled: active,
  });

  const panelsQuery = useQuery({
    ...orpc.panels.watch.experimental_liveOptions({
      input: { cwd: workspaceCwd },
      context: { cache: true },
      retry: true,
    }),
    queryKey: ["panels", "watch", workspaceCwd],
    enabled: active,
  });

  const incomingTabs = useMemo(() => tabsQuery.data as TabsType | undefined, [tabsQuery.data]);
  const incomingPanels = useMemo(() => panelsQuery.data as Panel[] | undefined, [panelsQuery.data]);

  useEffect(() => {
    if (!active || incomingTabs === undefined) {
      return;
    }

    setTabsData(cloneTabs(incomingTabs));
  }, [active, incomingTabs]);

  useEffect(() => {
    if (!active || incomingPanels === undefined) {
      return;
    }

    setPanelsData(clonePanels(incomingPanels));
  }, [active, incomingPanels]);

  const hasOpenTabs = useMemo(() => tabsData.groups.some((group) => group.tabs.length > 0), [tabsData]);

  useEffect(() => {
    onHasOpenTabsChange?.(hasOpenTabs);
  }, [hasOpenTabs, onHasOpenTabsChange]);

  useEffect(() => {
    if (!active) return;
    return onFocusPanel((panelId) => {
      const api = apiRef.current;
      if (!api) return;
      const panel = api.getPanel(panelId);
      if (panel) {
        panel.api.setActive();
        focusPanelContent(panelId);
      }
    });
  }, [active]);

  // Track whether the close was initiated while focus was inside the tabs pane.
  // We capture this *before* calling api.close() because dockview/xterm may blur
  // the focused element before the onDidRemovePanel callback fires.
  const closedWithFocusRef = useRef(false);

  const closeActiveTabLocally = useCallback(() => {
    const api = apiRef.current;
    if (!api) {
      return false;
    }

    const activePanel = api.activePanel;
    if (!activePanel) {
      return false;
    }

    closedWithFocusRef.current = containerRef.current?.contains(document.activeElement) ?? false;
    activePanel.api.close();
    return true;
  }, []);

  const isTabsPaneFocused = useCallback(() => {
    const tabsContainer = containerRef.current;
    return tabsContainer ? tabsContainer.contains(document.activeElement) : false;
  }, []);

  useKeybinding(
    "view.tabs",
    active
      ? (command) => {
          if (command === "view.tabs.close" && hasOpenTabs) {
            closeActiveTabLocally();
          }
        }
      : undefined,
    () => active && hasOpenTabs && isTabsPaneFocused(),
  );

  useLayoutEffect(() => {
    const api = apiRef.current;
    if (!api || !active) return;

    const panelMap = new Map(panelsData.map((panel) => [panel.id, panel]));

    const expectedTabIds = new Set<string>();
    tabsData.groups.forEach((group) => {
      group.tabs.forEach((tab) => {
        expectedTabIds.add(tab.id);
      });
    });

    const existingTabIds = new Set(api.panels.map((panel) => panel.id));

    tabsData.groups.forEach((group) => {
      group.tabs.forEach((tab) => {
        if (!existingTabIds.has(tab.id)) {
          const panel = panelMap.get(tab.panelId);
          if (panel) {
            const panelApi = api.addPanel({
              id: tab.id,
              component: "panel",
              params: panel,
              title: panel.title,
              tabComponent: "default",
            });
            panelApi.api.updateParameters(panel);
          }
        }
      });
    });

    // Update existing panels and close tabs no longer present on the server.
    existingTabIds.forEach((tabId) => {
      const panel = api.getPanel(tabId);
      if (!panel) {
        return;
      }

      if (!expectedTabIds.has(tabId)) {
        panel.api.close();
        return;
      }

      const panelData = panelMap.get(tabId);
      if (!panelData) {
        panel.api.close();
        return;
      }

      if (panel.api.title !== panelData.title) {
        panel.api.setTitle(panelData.title);
      }
      panel.api.updateParameters(panelData);
    });
  }, [active, tabsData, panelsData]);

  const handleReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    event.api.onDidRemovePanel((e) => {
      // Use the pre-captured focus flag since dockview/xterm blurs the element
      // before this callback fires, making a live contains() check unreliable.
      const hadFocus = closedWithFocusRef.current;
      closedWithFocusRef.current = false;

      setTabsData((current) => removeTab(current, e.id));
      setPanelsData((current) => current.filter((panel) => panel.id !== e.id));
      void client.tabs.close({ tabId: e.id, cwd: workspaceCwd });

      if (hadFocus) {
        requestAnimationFrame(() => {
          const nextActive = event.api.activePanel;
          if (nextActive) {
            focusPanelContent(nextActive.id);
          }
        });
      }
    });
  };

  return (
    <div ref={containerRef} className="relative flex size-full">
      <DockviewReact
        theme={theme}
        components={components}
        tabComponents={tabComponents}
        onReady={handleReady}
        disableFloatingGroups
      />
    </div>
  );
}

const theme = {
  name: "modern",
  className: "dockview-theme-modern",
  gap: 8,
};

export const Tabs = memo(TabsComponent);
