import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createExtension, diffs, executeCommand, listRegisteredCommands } from "./extension";
import { __resetStateForTests, state } from "./state";

describe("extension api", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "diffs-ext-"));
    process.env.DIFFS_STATE_PATH = path.join(tempRoot, "state.db");
    __resetStateForTests();
  });

  afterEach(async () => {
    delete process.env.DIFFS_STATE_PATH;
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("registers commands and executes them", async () => {
    const workspace = await createWorkspace(tempRoot, "workspace-a");

    const extension = createExtension(() => {
      return diffs.commands.registerCommand("example.hello", (name: string) => `hello ${name}`, {
        title: "Say Hello",
      });
    });

    const disposable = await extension.activate({ extensionId: "example", cwd: workspace });
    state.workspaces.value = { active: workspace, open: [workspace] };

    expect(listRegisteredCommands()).toHaveLength(1);

    expect(executeCommand("example.hello", "diffs")).resolves.toBe("hello diffs");

    disposable?.[Symbol.dispose]();

    expect(executeCommand("example.hello", "diffs")).rejects.toThrow(/not registered/);
  });

  test("executeCommand requires an active workspace", async () => {
    const workspace = await createWorkspace(tempRoot, "workspace-exec");

    const extension = createExtension(() => {
      return diffs.commands.registerCommand("example.needs-workspace", () => "ok");
    });

    const disposable = await extension.activate({ extensionId: "example", cwd: workspace });

    await expect(executeCommand("example.needs-workspace")).rejects.toThrow(/active workspace/);

    disposable?.[Symbol.dispose]();
  });

  test("storage persists per workspace and extension", async () => {
    const workspaceA = await createWorkspace(tempRoot, "ws-a");
    const workspaceB = await createWorkspace(tempRoot, "ws-b");

    const writer = createExtension(async () => {
      await diffs.storage.set("token", "alpha");
      expect(diffs.storage.keys()).toEqual(["token"]);
    });
    await writer.activate({ extensionId: "ext.alpha", cwd: workspaceA });

    const readerSame = createExtension(() => {
      expect(diffs.storage.keys()).toContain("token");
      expect(diffs.storage.get<any>("token")).toBe("alpha");
    });
    await readerSame.activate({ extensionId: "ext.alpha", cwd: workspaceA });

    const readerOtherWorkspace = createExtension(() => {
      expect(diffs.storage.keys()).toHaveLength(0);
      expect(diffs.storage.get("token")).toBeUndefined();
    });
    await readerOtherWorkspace.activate({ extensionId: "ext.alpha", cwd: workspaceB });

    const readerOtherExtension = createExtension(() => {
      expect(diffs.storage.keys()).toHaveLength(0);
      expect(diffs.storage.get("token", "fallback")).toBe("fallback");
    });
    await readerOtherExtension.activate({ extensionId: "ext.beta", cwd: workspaceA });
  });

  test("workspace.openTextDocument reads files and supports ranges", async () => {
    const workspace = await createWorkspace(tempRoot, "ws-doc");
    await writeFile(path.join(workspace, "note.ts"), "line 1\nline 2\n");

    const extension = createExtension(async () => {
      const doc = await diffs.workspace.openTextDocument("note.ts");
      expect(doc.fileName.endsWith("note.ts")).toBe(true);
      expect(doc.languageId).toBe("typescript");
      expect(doc.getText()).toBe("line 1\nline 2\n");

      const snippet = doc.getText({
        start: { line: 0, character: 5 },
        end: { line: 1, character: 4 },
      });
      expect(snippet).toBe("1\nline");
    });

    await extension.activate({ extensionId: "ext.workspace", cwd: workspace });
  });

  test("window.createReactPanel returns disposable panels", async () => {
    const workspace = await createWorkspace(tempRoot, "ws-panel");
    const extension = createExtension(() => {
      const panel = diffs.window.createReactPanel("diffs.panel", "./panel.tsx", "Sample Panel", "rocket");
      expect(panel.viewType).toBe("diffs.panel");
      expect(panel.title).toBe("Sample Panel");
      panel.title = "New Title";
      expect(panel.title).toBe("New Title");
      panel[Symbol.dispose]();
      panel[Symbol.dispose](); // idempotent
    });

    await extension.activate({ extensionId: "ext.window", cwd: workspace });
  });

  test("diffs access outside context throws", () => {
    expect(() => {
      // Accessing any property should raise because no context is active.
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      diffs.commands;
    }).toThrow(/active extension context/);
  });
});

async function createWorkspace(root: string, name: string): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  return dir;
}
