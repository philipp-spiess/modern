import { describe, expect, test } from "bun:test";
import { isExploreCommand } from "./explore-command";

describe("isExploreCommand", () => {
  test("marks basic search commands as explore", () => {
    expect(isExploreCommand("rg -n MessageContent packages/client/src/extensions/agent/messages.tsx")).toBe(true);
  });

  test("marks chained read-only commands as explore", () => {
    expect(
      isExploreCommand(
        'cd /Users/philipp/dev/modern && git show 0eaf1a4:packages/client/src/extensions/agent/messages.tsx | grep -n "MessageContent"',
      ),
    ).toBe(true);
  });

  test("does not mark mixed mutating commands as explore", () => {
    expect(
      isExploreCommand("rm -rf tmp && rg -n MessageContent packages/client/src/extensions/agent/messages.tsx"),
    ).toBe(false);
  });

  test("only allows read-only git subcommands", () => {
    expect(isExploreCommand("git status --short")).toBe(true);
    expect(isExploreCommand('git commit -m "wip"')).toBe(false);
  });

  test("ignores separators inside quoted patterns", () => {
    expect(isExploreCommand("grep 'foo|bar' packages/client/src/extensions/agent/messages.tsx")).toBe(true);
  });
});
