import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  __resetStateForTests,
  attachPanel,
  closeTab,
  detachPanel,
  getWorkspaceActiveThread,
  openWorkspace,
  Panel,
  removeWorkspace,
  setWorkspaceActiveThread,
  state,
} from "./state";

describe("tabs", () => {
  const workspace = "/tmp/modern-state-test";

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

  describe("workspace thread selection", () => {
    test("stores the active thread for the active workspace", () => {
      setWorkspaceActiveThread(workspace, {
        kind: "existing",
        threadPath: "threads/current.jsonl",
        title: "Current Thread",
      });

      const thread = getWorkspaceActiveThread(workspace);
      expect(thread).toEqual({
        kind: "existing",
        threadPath: `${workspace}/threads/current.jsonl`,
        title: "Current Thread",
      });

      expect(state.activeThread.value).toEqual(thread);
    });

    test("stores draft thread selection", () => {
      setWorkspaceActiveThread(workspace, {
        kind: "draft",
        title: "New Thread",
      });

      const thread = getWorkspaceActiveThread(workspace);
      expect(thread).toEqual({
        kind: "draft",
        title: "New Thread",
      });

      expect(state.activeThread.value).toEqual(thread);
    });

    test("clears active thread when set to null", () => {
      setWorkspaceActiveThread(workspace, {
        kind: "existing",
        threadPath: "threads/current.jsonl",
      });

      setWorkspaceActiveThread(workspace, null);

      expect(getWorkspaceActiveThread(workspace)).toBeNull();
      expect(state.activeThread.value).toBeNull();
    });
  });
});

describe("openWorkspace", () => {
  const createdPaths: string[] = [];

  afterEach(async () => {
    __resetStateForTests();
    await Promise.all(
      createdPaths.splice(0).map((cwd) =>
        rm(cwd, { recursive: true, force: true }).catch(() => {
          // Ignore cleanup errors in tests.
        }),
      ),
    );
  });

  test("throws when .git is missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "modern-open-workspace-no-git-"));
    createdPaths.push(workspace);

    await expect(openWorkspace(workspace)).rejects.toThrow(/not a git repository/i);
  });

  test("opens workspace when .git exists", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "modern-open-workspace-git-"));
    createdPaths.push(workspace);
    await mkdir(path.join(workspace, ".git"), { recursive: true });

    await openWorkspace(workspace);

    expect(state.workspaces.value.active).toBe(path.resolve(workspace));
    expect(state.workspaces.value.open).toContain(path.resolve(workspace));
  });

  test("removes workspace and falls back to another open workspace", async () => {
    const firstWorkspace = await mkdtemp(path.join(os.tmpdir(), "modern-remove-workspace-first-"));
    const secondWorkspace = await mkdtemp(path.join(os.tmpdir(), "modern-remove-workspace-second-"));
    createdPaths.push(firstWorkspace, secondWorkspace);

    await mkdir(path.join(firstWorkspace, ".git"), { recursive: true });
    await mkdir(path.join(secondWorkspace, ".git"), { recursive: true });

    await openWorkspace(firstWorkspace);
    await openWorkspace(secondWorkspace);
    await removeWorkspace(secondWorkspace);

    expect(state.workspaces.value.active).toBe(path.resolve(firstWorkspace));
    expect(state.workspaces.value.open).toContain(path.resolve(firstWorkspace));
    expect(state.workspaces.value.open).not.toContain(path.resolve(secondWorkspace));
  });

  test("removing the last workspace clears active workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "modern-remove-workspace-last-"));
    createdPaths.push(workspace);

    await mkdir(path.join(workspace, ".git"), { recursive: true });

    await openWorkspace(workspace);
    await removeWorkspace(workspace);

    expect(state.workspaces.value.active).toBeNull();
    expect(state.workspaces.value.open).toEqual([]);
  });
});
