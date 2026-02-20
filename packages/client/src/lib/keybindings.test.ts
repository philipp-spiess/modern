import { describe, expect, mock, test } from "bun:test";

mock.module("./rpc", () => ({
  orpc: {
    commands: {
      list: {
        experimental_liveOptions: () => ({}),
      },
    },
  },
}));

const { normalizeBindings, parseShortcut, shortcutMatches, toCodemirrorShortcut } = await import("./keybindings");

describe("parseShortcut", () => {
  test("parses modifiers and key", () => {
    const shortcut = parseShortcut("Cmd+Shift+P", { platform: "darwin" });

    expect(shortcut.keys).toHaveLength(1);
    expect(shortcut.keys[0].modifiers).toEqual(["cmd", "shift"]);
    expect(shortcut.keys[0].key).toBe("p");
  });

  test("splits multi-stroke sequences", () => {
    const shortcut = parseShortcut("ctrl+k ctrl+c", { platform: "win32" });

    expect(shortcut.keys).toHaveLength(2);
    expect(shortcut.keys[0]).toEqual({ modifiers: ["ctrl"], key: "k" });
    expect(shortcut.keys[1]).toEqual({ modifiers: ["ctrl"], key: "c" });
  });

  test("maps Mod to the platform-specific modifier", () => {
    expect(parseShortcut("mod+s", { platform: "darwin" }).keys[0].modifiers).toEqual(["cmd"]);
    expect(parseShortcut("mod+s", { platform: "win32" }).keys[0].modifiers).toEqual(["ctrl"]);
  });
});

describe("shortcutMatches", () => {
  test("matches case-insensitive keys with exact modifiers", () => {
    const shortcut = parseShortcut("cmd+s", { platform: "darwin" });
    const event = {
      key: "S",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    } as KeyboardEvent;

    expect(shortcutMatches(shortcut, event)).toBe(true);
    expect(shortcutMatches(shortcut, { ...event, shiftKey: true })).toBe(false);
  });

  test("supports chorded shortcuts using the chord index", () => {
    const shortcut = parseShortcut("ctrl+k ctrl+c", { platform: "win32" });
    const first = { key: "k", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent;
    const second = { key: "c", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent;

    expect(shortcutMatches(shortcut, first, 0)).toBe(true);
    expect(shortcutMatches(shortcut, second, 1)).toBe(true);
  });
});

describe("toCodemirrorShortcut", () => {
  test("formats modifiers before default keymap", () => {
    expect(toCodemirrorShortcut(parseShortcut("shift+cmd+p", { platform: "darwin" }))).toBe("Shift-Mod-p");
  });

  test("joins chords with spaces", () => {
    expect(toCodemirrorShortcut(parseShortcut("ctrl+k ctrl+c", { platform: "win32" }))).toBe("Ctrl-k Ctrl-c");
  });
});

describe("normalizeBindings", () => {
  test("defaults scope to global when omitted", () => {
    const bindings = normalizeBindings([
      { command: "files.save", defaultKeybinding: { key: "cmd+s" } },
      { command: "noop" },
    ]);

    expect(bindings).toHaveLength(1);
    expect(bindings[0].scope).toBe("global");
    expect(bindings[0].command).toBe("files.save");
  });
});
