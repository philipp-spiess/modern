import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let moduleCounter = 0;
let tempHome: string;
let currentModule: typeof import("./settings") | null = null;

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), "diffs-settings-"));
  process.env.DIFFS_SETTINGS_PATH = path.join(tempHome, "settings.json");
});

afterEach(async () => {
  if (currentModule) {
    currentModule.__stopSettingsWatcherForTests();
    currentModule = null;
  }
  delete process.env.DIFFS_SETTINGS_PATH;
  await rm(tempHome, { recursive: true, force: true });
});

async function loadSettingsModule() {
  const mod = await import(`./settings?test=${moduleCounter++}`);
  currentModule = mod;
  return mod;
}

describe("settings settings", () => {
  test("writes settings values and persists to disk", async () => {
    const settings = await loadSettingsModule();

    const next = await settings.writeSettings(["editor", "fontSize"], 18);

    expect(next.editor.fontSize).toBe(18);

    const fileContents = await readFile(settings.getSettingsPath(), "utf8");
    const parsed = JSON.parse(fileContents);
    expect(parsed.editor.fontSize).toBe(18);
    expect(parsed.editor.fontFamily).toBeUndefined();
  });

  test("invalid leaves fall back to defaults while preserving siblings", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const settings = await loadSettingsModule();

    const updated = await settings.writeSettings(["editor", "fontSize"], 64);

    expect(updated.editor.fontSize).toBe(14);
    expect(updated.editor.fontFamily).toBe("JetBrains Mono");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    const fileContents = await readFile(settings.getSettingsPath(), "utf8");
    const parsed = JSON.parse(fileContents);
    // The raw file should contain the invalid value
    expect(parsed.editor.fontSize).toBe(64);
  });

  test("starts with empty settings file", async () => {
    const settings = await loadSettingsModule();
    await settings.ensureSettingsFile();
    const content = await readFile(settings.getSettingsPath(), "utf8");
    const parsed = JSON.parse(content);
    expect(Object.keys(parsed).length).toBe(0);
  });

  test("reload picks up external edits", async () => {
    const settings = await loadSettingsModule();
    const settingsPath = settings.getSettingsPath();

    await settings.writeSettings(["editor", "fontSize"], 14);

    const external = { editor: { fontSize: 20, fontFamily: "Hack" } };
    await Bun.write(settingsPath, JSON.stringify(external));

    const reloaded = await settings.reloadSettings();
    expect(reloaded.editor.fontSize).toBe(20);
    expect(reloaded.editor.fontFamily).toBe("Hack");
  });
});
