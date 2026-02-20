import { signal } from "@preact/signals-core";
import { parse, stringify } from "comment-json";
import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import * as z from "zod";

export const schema = z
  .object({
    editor: z
      .object({
        fontFamily: z.string().trim().min(1).default("JetBrains Mono"),
        fontSize: z.number().int().min(8).max(48).default(14),
      })
      .default({
        fontFamily: "JetBrains Mono",
        fontSize: 14,
      }),
  })
  .strip();

export type Settings = z.infer<typeof schema>;

let settingsPath = resolveSettingsPath();

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let watcher: FSWatcher | null = null;
let lastHash = "";

// Holds the raw JSON object read from disk.
// This separates the persisted state (raw) from the application state (computed with defaults).
let rawSettings: Record<string, any> = await loadRawSettings();

// The computed settings signal (merged with defaults)
export const settings = signal<Settings>(computeSettings(rawSettings));

lastHash = hashSettings(settings.value);

void startWatching();

export function getSettingsPath(): string {
  return settingsPath;
}

export async function reloadSettings(): Promise<Settings> {
  rawSettings = await loadRawSettings();
  return updateSettingsSignal();
}

export async function writeSettings(keyPath: string[], value: unknown): Promise<Settings> {
  if (!Array.isArray(keyPath) || keyPath.length === 0) {
    throw new Error("keyPath must contain at least one segment");
  }

  // Apply change to raw settings and persist
  rawSettings = applyAtPath(rawSettings, keyPath, value);
  await persistRawSettings(rawSettings);

  // Update computed settings
  return updateSettingsSignal();
}

export async function ensureSettingsFile(): Promise<string> {
  const file = Bun.file(settingsPath);
  if (!(await file.exists())) {
    await ensureSettingsDirectory();
    // Create an empty file, do NOT fill with defaults
    await Bun.write(settingsPath, "{}\n");
  }
  return settingsPath;
}

export function __stopSettingsWatcherForTests() {
  watcher?.close();
  watcher = null;
}

function resolveSettingsPath(): string {
  if (process.env.DIFFS_SETTINGS_PATH) {
    return path.resolve(process.env.DIFFS_SETTINGS_PATH);
  }
  return path.join(homedir(), ".diffs", "settings.json");
}

async function ensureSettingsDirectory(): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
}

async function loadRawSettings(): Promise<Record<string, any>> {
  const file = Bun.file(settingsPath);
  if (!(await file.exists())) {
    return {};
  }

  try {
    const text = await file.text();
    const parsed = parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    console.error(`Failed to read settings at ${settingsPath}:`, error);
    return {};
  }
}

async function persistRawSettings(raw: unknown): Promise<void> {
  await ensureSettingsDirectory();
  const serialized = stringify(raw, null, 2);
  await Bun.write(settingsPath, serialized + (serialized.endsWith("\n") ? "" : "\n"));
}

function computeSettings(raw: unknown): Settings {
  return validateNode(schema, raw, schema.parse({}), []);
}

function updateSettingsSignal(): Settings {
  const next = computeSettings(rawSettings);
  const nextHash = hashSettings(next);
  if (nextHash === lastHash) return settings.value;

  settings.value = next;
  lastHash = nextHash;
  return next;
}

function validateNode(schemaNode: z.ZodTypeAny, rawValue: unknown, defaultValue: unknown, pathSegments: string[]): any {
  if (schemaNode instanceof z.ZodObject) {
    const shape = schemaNode.shape;
    const result: Record<string, unknown> = {};
    const valueObject = isPlainObject(rawValue) ? (rawValue as Record<string, unknown>) : {};
    const defaultsObject = isPlainObject(defaultValue) ? (defaultValue as Record<string, unknown>) : {};

    for (const key of Object.keys(shape)) {
      const childSchema = shape[key];
      result[key] = validateNode(childSchema, valueObject[key], defaultsObject[key], [...pathSegments, key]);
    }

    // Strip unknowns using the schema without re-validating children.
    return schemaNode.strip().parse(result);
  }

  const parsed = schemaNode.safeParse(rawValue);
  if (parsed.success) {
    return parsed.data;
  }

  if (rawValue !== undefined) {
    const leafPath = pathSegments.join(".") || "<root>";
    console.warn(`${leafPath} invalid: ${parsed.error.issues[0]?.message ?? parsed.error.message}`);
  }

  // Fallback to the provided default leaf.
  const fallback = defaultValue !== undefined ? defaultValue : schemaNode.parse(undefined);
  return fallback;
}

function applyAtPath(current: Record<string, any>, keyPath: string[], value: unknown): Record<string, any> {
  const next = structuredClone(current);
  let cursor: Record<string, any> = next;

  for (let index = 0; index < keyPath.length; index += 1) {
    const key = keyPath[index];
    if (index === keyPath.length - 1) {
      cursor[key] = value;
      break;
    }

    const existing = cursor[key];
    if (!isPlainObject(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  return next;
}

async function startWatching() {
  if (watcher) return;
  try {
    await ensureSettingsDirectory();
  } catch (error) {
    console.error("Failed to create settings directory", error);
  }

  try {
    watcher = watch(path.dirname(settingsPath), { persistent: false }, (_event, filename) => {
      if (!filename) return;
      const target = path.resolve(path.dirname(settingsPath), filename.toString());
      if (target !== settingsPath) return;

      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void reloadSettings();
      }, 50);
    });
  } catch (error) {
    console.error("Failed to start settings watcher", error);
  }
}

function hashSettings(value: Settings): string {
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
