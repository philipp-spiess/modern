import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import simpleGit from "simple-git";
import { buildWorkingChangesSnapshot } from "./git";

describe("buildWorkingChangesSnapshot", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "modern-git-snapshot-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("returns empty patch and files on a clean workspace", async () => {
    const { repoRoot } = await createRepoFixture(tempRoot);

    const snapshot = await buildWorkingChangesSnapshot({ cwd: repoRoot });

    expect(snapshot.patch).toBe("");
    expect(snapshot.files).toEqual([]);
  });

  test("includes modified tracked files", async () => {
    const { repoRoot } = await createRepoFixture(tempRoot);
    await writeFile(path.join(repoRoot, "tracked.txt"), "updated\n");

    const snapshot = await buildWorkingChangesSnapshot({ cwd: repoRoot });

    expect(snapshot.files).toContainEqual({ path: "tracked.txt", kind: "modified" });
    expect(snapshot.patch).toContain("diff --git a/tracked.txt b/tracked.txt");
  });

  test("includes deleted files", async () => {
    const { git, repoRoot } = await createRepoFixture(tempRoot);
    await git.rm("tracked.txt");

    const snapshot = await buildWorkingChangesSnapshot({ cwd: repoRoot });

    expect(snapshot.files).toContainEqual({ path: "tracked.txt", kind: "deleted" });
    expect(snapshot.patch).toContain("diff --git a/tracked.txt b/tracked.txt");
  });

  test("includes renamed files", async () => {
    const { git, repoRoot } = await createRepoFixture(tempRoot);
    await git.mv("tracked.txt", "renamed.txt");

    const snapshot = await buildWorkingChangesSnapshot({ cwd: repoRoot });

    expect(snapshot.files).toContainEqual({ path: "renamed.txt", kind: "renamed" });
  });

  test("includes untracked files with synthetic patches", async () => {
    const { repoRoot } = await createRepoFixture(tempRoot);
    await writeFile(path.join(repoRoot, "new-file.txt"), "hello\nworld\n");

    const snapshot = await buildWorkingChangesSnapshot({ cwd: repoRoot });

    expect(snapshot.files).toContainEqual({ path: "new-file.txt", kind: "untracked" });
    expect(snapshot.patch).toContain("diff --git a/new-file.txt b/new-file.txt");
    expect(snapshot.patch).toContain("--- /dev/null");
    expect(snapshot.patch).toContain("+++ b/new-file.txt");
  });

  test("returns stable snapshots when nothing changed", async () => {
    const { repoRoot } = await createRepoFixture(tempRoot);

    const first = await buildWorkingChangesSnapshot({ cwd: repoRoot });
    const second = await buildWorkingChangesSnapshot({ cwd: repoRoot });

    expect(second.patch).toBe(first.patch);
    expect(second.files).toEqual(first.files);
  });
});

async function createRepoFixture(root: string) {
  const repoRoot = await mkdtemp(path.join(root, "repo-"));
  const git = simpleGit(repoRoot);

  await git.init();
  await git.addConfig("user.name", "Modern Tests");
  await git.addConfig("user.email", "modern-tests@example.com");

  await mkdir(path.join(repoRoot, "nested"), { recursive: true });
  await writeFile(path.join(repoRoot, "tracked.txt"), "initial\n");
  await writeFile(path.join(repoRoot, "nested", "note.txt"), "nested\n");

  await git.add(".");
  await git.commit("Initial");

  return { repoRoot, git };
}
