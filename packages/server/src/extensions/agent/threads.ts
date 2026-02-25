import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type SessionInfo,
  type SessionHeader,
} from "@mariozechner/pi-coding-agent";
import { disposeThreadRuntimes } from "./runtime";

const DEFAULT_THREAD_LIMIT = 12;
const TITLE_RETRY_BACKOFF_MS = 5 * 60_000;
const TITLE_MAX_LENGTH = 80;
const TITLE_TASK_MAX_LENGTH = 1_500;
const DIRECT_FIRST_PROMPT_MAX_WORDS = 5;
const THREAD_LIFECYCLE_CUSTOM_TYPE = "modern.thread.lifecycle";

const TITLE_PROMPT_TEMPLATE = `Write a concise 3-6 word title for this coding task.
- No colons.
- Start with an uppercase letter.
- Do not force Title Case for every word.
- Keep natural casing from the task text.
- Keep acronyms like API, SDK, and PI uppercase when relevant.
- Output only the title.

Examples:
- "Review repo for risky patterns"
- "Migrate Vercel AI SDK to PI"
- "Add some unit tests"
- "Assess behavioral impact"

Task: "{prompt}"

Title:`;

const titleGenerationInFlight = new Set<string>();
const titleGenerationRetryAt = new Map<string, number>();
const titleModelBlacklist = new Set<string>();
let titleGenerationQueue: Promise<void> = Promise.resolve();

type AvailableModel = ReturnType<ModelRegistry["getAvailable"]>[number];

type ThreadLifecycleState = "active" | "archived";

interface ThreadLifecycleRecord {
  state: ThreadLifecycleState;
  archivedAt?: string;
  workspaceRootCwd?: string;
  previousCwd?: string;
}

export interface ThreadSummary {
  id: string;
  path: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  isTitleGenerating: boolean;
}

export interface WorkspaceThreads {
  cwd: string;
  threads: ThreadSummary[];
}

export async function listThreadsForWorkspace(cwd: string, limit = DEFAULT_THREAD_LIMIT): Promise<ThreadSummary[]> {
  const sessions = await SessionManager.list(cwd);

  const sorted = sessions
    .filter((session) => session.messageCount > 0)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());

  const max = Math.max(limit, 0);
  const output: ThreadSummary[] = [];

  for (const session of sorted) {
    if (output.length >= max) {
      break;
    }

    const lifecycle = readThreadLifecycleState(session.path);
    if (lifecycle === "archived") {
      continue;
    }

    output.push(toThreadSummary(session));
  }

  return output;
}

export async function removeThreadsForWorkspace(cwd: string): Promise<number> {
  const sessions = await SessionManager.list(cwd);
  const threadPaths = [...new Set(sessions.map((session) => path.resolve(session.path)))];

  if (threadPaths.length === 0) {
    return 0;
  }

  await disposeThreadRuntimes(threadPaths);
  await Promise.all(threadPaths.map((threadPath) => rm(threadPath, { force: true })));
  return threadPaths.length;
}

export async function archiveThreadForProject(
  projectCwd: string,
  threadPath: string,
): Promise<{ threadPath: string; previousCwd: string }> {
  const resolvedProjectCwd = path.resolve(projectCwd);
  const resolvedThreadPath = path.resolve(threadPath);

  await disposeThreadRuntimes([resolvedThreadPath]);

  const manager = SessionManager.open(resolvedThreadPath);
  const header = manager.getHeader();
  if (!header) {
    throw new Error(`Session header missing for thread "${resolvedThreadPath}".`);
  }

  const previousCwd = path.resolve(header.cwd || resolvedProjectCwd);

  manager.appendCustomEntry(THREAD_LIFECYCLE_CUSTOM_TYPE, {
    state: "archived",
    archivedAt: new Date().toISOString(),
    workspaceRootCwd: resolvedProjectCwd,
    previousCwd,
  } satisfies ThreadLifecycleRecord);

  const nextHeader: SessionHeader = {
    ...header,
    cwd: resolvedProjectCwd,
  };

  const entries = manager.getEntries();
  const targetDir = resolveSessionDirectoryForCwd(resolvedProjectCwd);
  await mkdir(targetDir, { recursive: true });

  const targetPath = await resolveArchiveTargetPath(targetDir, resolvedThreadPath);
  const tempPath = `${targetPath}.tmp-${randomUUID()}`;
  const serialized = serializeSession(nextHeader, entries);

  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, targetPath);

  if (resolvedThreadPath !== targetPath) {
    await rm(resolvedThreadPath, { force: true });
  }

  return {
    threadPath: targetPath,
    previousCwd,
  };
}

function toThreadSummary(session: SessionInfo): ThreadSummary {
  const explicitTitle = normalize(session.name);
  const firstPrompt = normalizeSessionFirstPrompt(session.firstMessage);

  if (explicitTitle) {
    return buildThreadSummary(session, truncate(explicitTitle, TITLE_MAX_LENGTH), false);
  }

  const directTitle = resolveDirectTitleFromFirstPrompt(firstPrompt);
  if (directTitle) {
    return buildThreadSummary(session, truncate(directTitle, TITLE_MAX_LENGTH), false);
  }

  const isTitleGenerating = queueTitleGenerationIfNeeded(session, firstPrompt);
  const fallbackTitle = firstPrompt ? truncate(firstPrompt, TITLE_MAX_LENGTH) : "Untitled Thread";

  return buildThreadSummary(session, fallbackTitle, isTitleGenerating);
}

function buildThreadSummary(session: SessionInfo, title: string, isTitleGenerating: boolean): ThreadSummary {
  return {
    id: session.id,
    path: session.path,
    title,
    createdAt: session.created.toISOString(),
    updatedAt: session.modified.toISOString(),
    messageCount: session.messageCount,
    isTitleGenerating,
  };
}

function resolveDirectTitleFromFirstPrompt(firstPrompt: string): string | null {
  if (!firstPrompt) {
    return null;
  }

  const wordCount = firstPrompt.split(/\s+/).filter(Boolean).length;
  if (wordCount > DIRECT_FIRST_PROMPT_MAX_WORDS) {
    return null;
  }

  return firstPrompt;
}

function queueTitleGenerationIfNeeded(session: SessionInfo, firstPrompt: string): boolean {
  if (!firstPrompt) {
    return false;
  }

  if (titleGenerationInFlight.has(session.path)) {
    return true;
  }

  const retryAt = titleGenerationRetryAt.get(session.path) ?? 0;
  if (retryAt > Date.now()) {
    return false;
  }

  titleGenerationInFlight.add(session.path);

  titleGenerationQueue = titleGenerationQueue
    .then(async () => {
      await generateAndPersistSessionTitle(session, firstPrompt);
      titleGenerationRetryAt.delete(session.path);
    })
    .catch((error) => {
      console.error(`Failed to generate pi session title for "${session.path}":`, error);
      titleGenerationRetryAt.set(session.path, Date.now() + TITLE_RETRY_BACKOFF_MS);
    })
    .finally(() => {
      titleGenerationInFlight.delete(session.path);
    });

  return true;
}

async function generateAndPersistSessionTitle(session: SessionInfo, firstPrompt: string): Promise<void> {
  const cwd = normalize(session.cwd) || process.cwd();
  const title = await generateTitleWithInMemorySession(cwd, firstPrompt);

  if (!title || !existsSync(session.path)) {
    return;
  }

  const manager = SessionManager.open(session.path);
  const existingTitle = normalize(manager.getSessionName());
  if (existingTitle) {
    return;
  }

  manager.appendSessionInfo(title);
}

async function generateTitleWithInMemorySession(cwd: string, firstPrompt: string): Promise<string | null> {
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const availableModels = modelRegistry.getAvailable();

  if (availableModels.length === 0) {
    return null;
  }

  const candidates = rankTitleModels(availableModels);

  for (const model of candidates) {
    const modelKey = `${model.provider}/${model.id}`;
    if (titleModelBlacklist.has(modelKey)) {
      continue;
    }

    const title = await tryGenerateTitle(cwd, authStorage, modelRegistry, model, firstPrompt);
    if (title) {
      return title;
    }

    titleModelBlacklist.add(modelKey);
  }

  return null;
}

async function tryGenerateTitle(
  cwd: string,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  model: AvailableModel,
  firstPrompt: string,
): Promise<string | null> {
  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: "off",
    tools: [],
    sessionManager: SessionManager.inMemory(cwd),
  });

  let output = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "message_update") {
      return;
    }

    if (event.assistantMessageEvent.type === "text_delta") {
      output += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(buildTitlePrompt(firstPrompt));
  } finally {
    unsubscribe();
    session.dispose();
  }

  return normalizeGeneratedTitle(output);
}

const TITLE_MODEL_IDS = ["gpt-5.1-codex-mini", "claude-haiku-4-5", "gemini-3-flash", "gemini-3-flash-preview"];
const TITLE_MODEL_PROVIDER_PREFERENCES = ["openai-codex", "openai", "anthropic", "google"];

function rankTitleModels(available: AvailableModel[]): AvailableModel[] {
  const ranked: AvailableModel[] = [];
  const seen = new Set<string>();

  for (const id of TITLE_MODEL_IDS) {
    const matches = available.filter((model) => model.id === id);
    if (matches.length === 0) {
      continue;
    }

    const preferred = TITLE_MODEL_PROVIDER_PREFERENCES.flatMap((provider) =>
      matches.filter((model) => model.provider === provider),
    );
    const remaining = matches
      .filter((model) => !preferred.includes(model))
      .sort((left, right) => left.provider.localeCompare(right.provider));

    for (const model of [...preferred, ...remaining]) {
      const modelKey = `${model.provider}/${model.id}`;
      if (seen.has(modelKey)) {
        continue;
      }

      seen.add(modelKey);
      ranked.push(model);
    }
  }

  return ranked;
}

function buildTitlePrompt(firstPrompt: string): string {
  return TITLE_PROMPT_TEMPLATE.replace("{prompt}", truncate(firstPrompt, TITLE_TASK_MAX_LENGTH));
}

function normalizeGeneratedTitle(value: string): string | null {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return null;
  }

  const cleaned = normalize(
    firstLine
      .replace(/^title\s*:\s*/i, "")
      .replace(/^[-*]\s+/, "")
      .replace(/^['"`]+|['"`]+$/g, "")
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1"),
  );

  if (!cleaned) {
    return null;
  }

  return truncate(cleaned, TITLE_MAX_LENGTH);
}

function readThreadLifecycleState(threadPath: string): ThreadLifecycleState {
  try {
    const manager = SessionManager.open(threadPath);
    const entries = manager.getEntries();

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry?.type !== "custom") {
        continue;
      }

      if (entry.customType !== THREAD_LIFECYCLE_CUSTOM_TYPE) {
        continue;
      }

      const data = entry.data as ThreadLifecycleRecord | undefined;
      if (data?.state === "archived") {
        return "archived";
      }

      if (data?.state === "active") {
        return "active";
      }
    }
  } catch {
    return "active";
  }

  return "active";
}

function serializeSession(header: SessionHeader, entries: ReturnType<SessionManager["getEntries"]>): string {
  return [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function resolveSessionDirectoryForCwd(cwd: string): string {
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(getAgentDir(), "sessions", safePath);
}

async function resolveArchiveTargetPath(targetDir: string, sourcePath: string): Promise<string> {
  const fileName = path.basename(sourcePath);
  const defaultTarget = path.join(targetDir, fileName);

  if (path.resolve(defaultTarget) === path.resolve(sourcePath)) {
    return defaultTarget;
  }

  if (!existsSync(defaultTarget)) {
    return defaultTarget;
  }

  const parsed = path.parse(fileName);
  const candidate = `${parsed.name}-${Date.now()}${parsed.ext}`;
  return path.join(targetDir, candidate);
}

function normalizeSessionFirstPrompt(value?: string): string {
  if (!value || value === "(no messages)") {
    return "";
  }
  return normalize(value);
}

function normalize(value?: string): string {
  if (!value) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sliceLength = Math.max(0, maxLength - 3);
  return `${value.slice(0, sliceLength).trimEnd()}...`;
}
