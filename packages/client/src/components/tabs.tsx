import type { Panel, Tabs as TabsType } from "@diffs-io/server/src/state";
import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DockviewReact, type DockviewReadyEvent } from "dockview";
import { Loader2Icon, XIcon } from "lucide-react";
import { DynamicIcon } from "lucide-react/dynamic";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { client, orpc } from "../lib/rpc";

import "dockview/dist/styles/dockview.css";

const emptyTabs: TabsType = { groups: [] };
const emptyPanels: Panel[] = [];

const moduleCache = new Map<string, any>();

function loadModule(modulePath: string): any {
  if (!moduleCache.has(modulePath)) {
    const LazyComponent = lazy(() => import(/* @vite-ignore */ `../extensions/${modulePath}`));
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

  const onClose = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      api.close();
    },
    [api],
  );

  return (
    <div className="flex items-center h-full group outline-none after:bg-transparent!">
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

export function Tabs({ active, workspaceCwd }: TabsProps) {
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

  const getFallbackTabId = useCallback(() => {
    for (const group of tabsData.groups) {
      const first = group.tabs[0];
      if (first) return first.id;
    }
    return null;
  }, [tabsData]);

  const getActiveTabId = useCallback(() => {
    const api = apiRef.current as any;
    const activePanel = api?.activePanel ?? api?.activeGroup?.activePanel;
    return activePanel?.id ?? activePanel?.panel?.id ?? null;
  }, []);

  const closeTabLocally = useCallback((tabId: string) => {
    const api = apiRef.current;
    const panel = api?.getPanel(tabId);
    if (!panel) {
      return false;
    }

    panel.api.close();
    return true;
  }, []);

  const closeActiveTab = useCallback(() => {
    const tabId = getActiveTabId();
    if (!tabId) return false;
    return closeTabLocally(tabId);
  }, [closeTabLocally, getActiveTabId]);

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
      setTabsData((current) => removeTab(current, e.id));
      setPanelsData((current) => current.filter((panel) => panel.id !== e.id));
      void client.tabs.close({ tabId: e.id, cwd: workspaceCwd });
    });
  };

  useEffect(() => {
    if (!active) {
      return;
    }

    // Skip when Tauri APIs are unavailable (e.g., running in plain browser for tests).
    if ("__TAURI_SYNC_STATUS__" in globalThis && (globalThis as any)["__TAURI_SYNC_STATUS__"].role === "follower")
      return;

    const window = getCurrentWindow();

    const unlistenPromise = window.onCloseRequested((event) => {
      if (!hasOpenTabs) return;

      const closedActive = closeActiveTab();
      if (closedActive) {
        event.preventDefault();
        return;
      }

      const fallbackTabId = getFallbackTabId();
      if (fallbackTabId) {
        event.preventDefault();
        closeTabLocally(fallbackTabId);
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [active, closeActiveTab, closeTabLocally, getFallbackTabId, hasOpenTabs]);

  return (
    <div className="relative flex size-full">
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
  name: "diffs",
  className: "dockview-theme-diffs",
  gap: 8,
};
