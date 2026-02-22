import { describe, expect, test } from "bun:test";
import { FileStore } from "./file-store";

function createStore(files: string[], ignorePatterns: string[] = []) {
  return new FileStore("/fake", {
    collectPaths: async () => files,
    checkIgnore: async (path) =>
      ignorePatterns.some((pattern) => {
        if (pattern.endsWith("/")) return path.startsWith(pattern);
        if (pattern.startsWith("*.")) return path.endsWith(pattern.slice(1));
        return path === pattern;
      }),
  });
}

describe("fileStore", () => {
  test("should exclude gitignored files added via watcher", async () => {
    const store = createStore(
      ["src/app.ts", "src/utils.ts", "config.json"],
      ["dist/", "node_modules/", "*.tmp", ".env"],
    );
    await store.initialize();

    // Simulate watcher adding ignored files
    await store.addChecked("dist/bundle.js");
    await store.addChecked("node_modules/package/index.js");
    await store.addChecked(".env");
    await store.addChecked("temp.tmp");

    const bundleResults = store.query("bundle");
    const envResults = store.query("env");
    const tempResults = store.query("temp");
    const nodeModulesResults = store.query("node_modules");

    expect(bundleResults.map((r) => r.path)).not.toContain("dist/bundle.js");
    expect(envResults.map((r) => r.path)).not.toContain(".env");
    expect(tempResults.map((r) => r.path)).not.toContain("temp.tmp");
    expect(nodeModulesResults.map((r) => r.path)).not.toContain("node_modules/package/index.js");
  });

  test("should include non-ignored files in search results", async () => {
    const store = createStore(["src/index.ts", "src/components/button.tsx", "README.md"], ["*.log", "temp/"]);
    await store.initialize();

    const indexResults = store.query("index");
    expect(indexResults.map((r) => r.path)).toContain("src/index.ts");

    const buttonResults = store.query("button");
    expect(buttonResults.map((r) => r.path)).toContain("src/components/button.tsx");
  });

  test("should handle watcher files and respect gitignore", async () => {
    const store = createStore(["src/main.ts"], ["*.tmp", "build/"]);
    await store.initialize();

    // Simulate watcher: one ignored, one not
    await store.addChecked("test.tmp");
    await store.addChecked("src/new-component.tsx");

    const componentResults = store.query("component");
    const testResults = store.query("test");

    expect(componentResults.map((r) => r.path)).toContain("src/new-component.tsx");
    expect(testResults.map((r) => r.path)).not.toContain("test.tmp");
  });

  test("should work without gitignore (graceful degradation)", async () => {
    const store = new FileStore("/fake", {
      collectPaths: async () => ["file1.ts", "file2.ts"],
      checkIgnore: async () => false,
    });
    await store.initialize();

    const results = store.query("file");
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.path).sort()).toEqual(["file1.ts", "file2.ts"]);
  });

  test("should skip .git paths", async () => {
    const store = createStore([]);
    await store.initialize();

    store.addDirect(".git");
    store.addDirect(".git/config");
    store.addDirect("src/app.ts");

    expect(store.map.has(".git")).toBe(false);
    expect(store.map.has(".git/config")).toBe(false);
    expect(store.map.has("src/app.ts")).toBe(true);
  });

  test("should not add duplicate entries", async () => {
    const store = createStore(["src/app.ts"]);
    await store.initialize();

    store.addDirect("src/app.ts");
    await store.addChecked("src/app.ts");

    expect(store.entries.length).toBe(1);
  });

  test("should remove entries and prefixes", async () => {
    const store = createStore(["src/a.ts", "src/b.ts", "lib/c.ts"]);
    await store.initialize();

    store.remove("src/a.ts");
    expect(store.map.has("src/a.ts")).toBe(false);
    expect(store.entries.length).toBe(2);

    store.removePrefix("src/");
    expect(store.map.has("src/b.ts")).toBe(false);
    expect(store.entries.length).toBe(1);
    expect(store.map.has("lib/c.ts")).toBe(true);
  });
});
