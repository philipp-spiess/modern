import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStateForTests, attachPanel, closeTab, detachPanel, Panel, state } from "./state";

describe("tabs", () => {
  const workspace = "/tmp/diffs-state-test";

  beforeEach(() => {
    state.workspaces.value = { active: workspace, open: [workspace] };
  });

  afterEach(() => __resetStateForTests());

  describe("attachPanel (private open)", () => {
    test("creates first group when no groups exist", () => {
      const panel: Panel = {
        id: "panel-1",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel",
        state: {},
      };

      attachPanel(workspace, panel);

      const tabs = state.tabs.value;
      expect(tabs.groups).toHaveLength(1);
      expect(tabs.groups[0].tabs).toHaveLength(1);
      expect(tabs.groups[0].tabs[0].panelId).toBe("panel-1");
      expect(tabs.groups[0].tabs[0].id).toBe("panel-1");
      expect(state.panels.value.has("panel-1")).toBe(true);
    });

    test("adds to first group when groups exist", () => {
      const panel1: Panel = {
        id: "panel-1",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel 1",
        state: {},
      };
      const panel2: Panel = {
        id: "panel-2",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel 2",
        state: {},
      };

      attachPanel(workspace, panel1);
      attachPanel(workspace, panel2);

      const tabs = state.tabs.value;
      expect(tabs.groups).toHaveLength(1);
      expect(tabs.groups[0].tabs).toHaveLength(2);
      expect(tabs.groups[0].tabs[1].panelId).toBe("panel-2");
    });
  });

  describe("closeTab", () => {
    test("removes tab from group", () => {
      const panel1: Panel = {
        id: "panel-1",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel 1",
        state: {},
      };
      const panel2: Panel = {
        id: "panel-2",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel 2",
        state: {},
      };

      attachPanel(workspace, panel1);
      attachPanel(workspace, panel2);

      closeTab("panel-1");

      const tabs = state.tabs.value;
      expect(tabs.groups).toHaveLength(1);
      expect(tabs.groups[0].tabs).toHaveLength(1);
      expect(tabs.groups[0].tabs[0].panelId).toBe("panel-2");
    });

    test("removes group when last tab is closed", () => {
      const panel: Panel = {
        id: "panel-1",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel",
        state: {},
      };

      attachPanel(workspace, panel);
      closeTab("panel-1");

      const tabs = state.tabs.value;
      expect(tabs.groups).toHaveLength(0);
    });
  });

  describe("detachPanel", () => {
    test("removes panel and closes associated tab", () => {
      const panel: Panel = {
        id: "panel-1",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel",
        state: {},
      };

      attachPanel(workspace, panel);
      expect(state.panels.value.has("panel-1")).toBe(true);
      expect(state.tabs.value.groups).toHaveLength(1);

      detachPanel(workspace, "panel-1");

      expect(state.panels.value.has("panel-1")).toBe(false);
      expect(state.tabs.value.groups).toHaveLength(0);
    });

    test("only removes specified panel", () => {
      const panel1: Panel = {
        id: "panel-1",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel 1",
        state: {},
      };
      const panel2: Panel = {
        id: "panel-2",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel 2",
        state: {},
      };

      attachPanel(workspace, panel1);
      attachPanel(workspace, panel2);

      detachPanel(workspace, "panel-1");

      expect(state.panels.value.has("panel-1")).toBe(false);
      expect(state.panels.value.has("panel-2")).toBe(true);
      expect(state.tabs.value.groups[0].tabs).toHaveLength(1);
      expect(state.tabs.value.groups[0].tabs[0].panelId).toBe("panel-2");
    });
  });

  describe("panel state management", () => {
    test("stores panel state correctly", () => {
      const panel: Panel = {
        id: "panel-1",
        viewType: "test.view",
        module: "test.tsx",
        title: "Test Panel",
        icon: "file",
        state: { filePath: "/path/to/file.txt", cursor: { line: 10, col: 5 } },
      };

      attachPanel(workspace, panel);

      const storedPanel = state.panels.value.get("panel-1");
      expect(storedPanel).toBeDefined();
      expect(storedPanel?.state).toEqual({ filePath: "/path/to/file.txt", cursor: { line: 10, col: 5 } });
      expect(storedPanel?.icon).toBe("file");
    });
  });
});
