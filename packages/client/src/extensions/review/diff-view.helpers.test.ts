import { describe, expect, test } from "bun:test";
import { getChangedPaths, getFileStageState, normalizePath, type StatusFile } from "./diff-view.helpers";

describe("normalizePath", () => {
  test("normalizes slashes and strips common prefixes", () => {
    expect(normalizePath("a/src/app.ts")).toBe("src/app.ts");
    expect(normalizePath("b/src/app.ts")).toBe("src/app.ts");
    expect(normalizePath("./src\\\\app.ts")).toBe("src/app.ts");
  });
});

describe("getFileStageState", () => {
  test("returns staged when only index has changes", () => {
    expect(getFileStageState({ path: "a.txt", index: "M", working_dir: " " })).toBe("staged");
  });

  test("returns partial when index and working directory changed", () => {
    expect(getFileStageState({ path: "a.txt", index: "M", working_dir: "M" })).toBe("partial");
  });

  test("returns unstaged for untracked files", () => {
    expect(getFileStageState({ path: "a.txt", index: "?", working_dir: "?" })).toBe("unstaged");
  });
});

describe("getChangedPaths", () => {
  test("collects and sorts tracked and untracked paths", () => {
    const files: StatusFile[] = [
      { path: "z.txt", index: "M", working_dir: " " },
      { path: "a.txt", index: "?", working_dir: "?" },
      { path: "m.txt", index: " ", working_dir: "M" },
      { path: "clean.txt", index: " ", working_dir: " " },
    ];

    expect(getChangedPaths(files)).toEqual(["a.txt", "m.txt", "z.txt"]);
  });
});
