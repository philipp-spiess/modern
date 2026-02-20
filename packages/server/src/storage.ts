import { sql } from "@truto/sqlite-builder";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function keys(scope: string, cwd: string) {
  const workspace = normalizeWorkspace(cwd);
  return keysForWorkspace(scope, workspace);
}

export function get<T>(scope: string, cwd: string, key: string, defaultValue?: T): T | undefined {
  const workspace = normalizeWorkspace(cwd);
  return getForWorkspace<T>(scope, workspace, key, defaultValue);
}

export async function set<T>(scope: string, cwd: string, key: string, value: T): Promise<void> {
  const workspace = normalizeWorkspace(cwd);
  const payload = serialize(value);
  upsert(scope, workspace, key, payload);
}

export function keysGlobal(scope: string) {
  return keysForWorkspace(scope, GLOBAL_WORKSPACE);
}

export function getGlobal<T>(scope: string, key: string, defaultValue?: T): T | undefined {
  return getForWorkspace<T>(scope, GLOBAL_WORKSPACE, key, defaultValue);
}

export async function setGlobal<T>(scope: string, key: string, value: T): Promise<void> {
  const payload = serialize(value);
  upsert(scope, GLOBAL_WORKSPACE, key, payload);
}

export function shutdownStorage(): void {
  cachedDb?.close();
  cachedDb = undefined;
  activePath = undefined;
}

const DEFAULT_STATE_DIR = path.join(homedir(), ".diffs");
const DEFAULT_STATE_DB = path.join(DEFAULT_STATE_DIR, "state.db");
const GLOBAL_WORKSPACE = "__diffs_global__";

let cachedDb: Database | undefined;
let activePath: string | undefined;

function getDatabase(): Database {
  const targetPath = resolveStatePath();
  if (cachedDb && activePath === targetPath) {
    return cachedDb;
  }

  mkdirSync(path.dirname(targetPath), { recursive: true });
  cachedDb?.close();
  cachedDb = new Database(targetPath);
  activePath = targetPath;

  cachedDb.run(sql`PRAGMA journal_mode = WAL;`.text);
  cachedDb.run(
    sql`
      CREATE TABLE IF NOT EXISTS storage (
        workspace TEXT NOT NULL,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (workspace, scope, key)
      );
    `.text,
  );

  return cachedDb;
}

function keysForWorkspace(scope: string, workspace: string) {
  const query = sql`
    SELECT key
    FROM storage
    WHERE workspace = ${workspace} AND scope = ${scope}
    ORDER BY key ASC
  `;
  const stmt = getDatabase().query(query.text);
  return stmt.all(...(query.values as any)).map((row: any) => row.key);
}

function getForWorkspace<T>(scope: string, workspace: string, key: string, defaultValue?: T): T | undefined {
  const query = sql`
    SELECT value
    FROM storage
    WHERE workspace = ${workspace} AND scope = ${scope} AND key = ${key}
    LIMIT 1
  `;
  const stmt = getDatabase().query(query.text);
  const row = stmt.get(...(query.values as any));
  if (!row) return defaultValue;
  return deserialize((row as any).value) as T;
}

function upsert(scope: string, workspace: string, key: string, payload: string): void {
  const query = sql`
    INSERT INTO storage (workspace, scope, key, value)
    VALUES (${workspace}, ${scope}, ${key}, ${payload})
    ON CONFLICT(workspace, scope, key) DO UPDATE SET value = excluded.value
  `;
  getDatabase().run(query.text, ...(query.values as any));
}

function removeForWorkspace(scope: string, workspace: string, key: string): void {
  const query = sql`
    DELETE FROM storage
    WHERE workspace = ${workspace} AND scope = ${scope} AND key = ${key}
  `;
  getDatabase().run(query.text, ...(query.values as any));
}

function normalizeWorkspace(cwd: string): string {
  if (!cwd?.trim()) {
    throw new Error("diffs.storage requires a cwd argument.");
  }
  return path.resolve(cwd);
}

function resolveStatePath(): string {
  const override = process.env.DIFFS_STATE_PATH?.trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(override);
  }
  return DEFAULT_STATE_DB;
}

function serialize(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function deserialize(raw: string): unknown {
  return JSON.parse(raw);
}

export function remove(scope: string, cwd: string, key: string): void {
  const workspace = normalizeWorkspace(cwd);
  removeForWorkspace(scope, workspace, key);
}

export function removeGlobal(scope: string, key: string): void {
  removeForWorkspace(scope, GLOBAL_WORKSPACE, key);
}
