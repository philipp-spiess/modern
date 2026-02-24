import { existsSync } from "node:fs";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import type { AgentThreadMetaState, AgentThreadModelSummary, AgentThreadViewState, AvailableModelInfo } from "./types";

export interface AgentThreadRuntime {
  threadPath: string;
  session: AgentSession;
}

const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);
const settingsManager = SettingsManager.create();
const runtimeByThreadPath = new Map<string, Promise<AgentThreadRuntime>>();

async function disposeThreadRuntime(threadPath: string): Promise<void> {
  const resolvedPath = path.resolve(threadPath);
  const runtimePromise = runtimeByThreadPath.get(resolvedPath);
  if (!runtimePromise) {
    return;
  }

  runtimeByThreadPath.delete(resolvedPath);

  try {
    const runtime = await runtimePromise;
    runtime.session.dispose();
  } catch (error) {
    console.error(`Failed to dispose runtime for thread "${resolvedPath}":`, error);
  }
}

export async function disposeThreadRuntimes(threadPaths: readonly string[]): Promise<void> {
  await Promise.all(threadPaths.map((threadPath) => disposeThreadRuntime(threadPath)));
}

export async function getThreadRuntime(threadPath: string): Promise<AgentThreadRuntime> {
  const resolvedPath = path.resolve(threadPath);
  let runtimePromise = runtimeByThreadPath.get(resolvedPath);

  if (!runtimePromise) {
    runtimePromise = createPersistedThreadRuntime(resolvedPath);
    runtimeByThreadPath.set(resolvedPath, runtimePromise);
  }

  try {
    return await runtimePromise;
  } catch (error) {
    runtimeByThreadPath.delete(resolvedPath);
    throw error;
  }
}

export async function createThreadRuntimeForWorkspace(cwd: string): Promise<AgentThreadRuntime> {
  const resolvedCwd = path.resolve(cwd);
  const sessionManager = SessionManager.create(resolvedCwd);
  const threadPath = sessionManager.getSessionFile();

  if (!threadPath) {
    throw new Error(`Failed to create thread session for workspace "${resolvedCwd}".`);
  }

  const resolvedPath = path.resolve(threadPath);
  const runtimePromise = createThreadRuntime(resolvedPath, sessionManager, resolvedCwd);
  runtimeByThreadPath.set(resolvedPath, runtimePromise);

  try {
    return await runtimePromise;
  } catch (error) {
    runtimeByThreadPath.delete(resolvedPath);
    throw error;
  }
}

function resolveExistingThreadPath(threadPath: string): string {
  const resolvedPath = path.resolve(threadPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Thread file does not exist: ${resolvedPath}`);
  }

  return resolvedPath;
}

async function createPersistedThreadRuntime(threadPath: string): Promise<AgentThreadRuntime> {
  const resolvedPath = resolveExistingThreadPath(threadPath);
  const sessionManager = SessionManager.open(resolvedPath);
  return createThreadRuntime(resolvedPath, sessionManager);
}

async function createThreadRuntime(
  threadPath: string,
  sessionManager: SessionManager,
  cwdOverride?: string,
): Promise<AgentThreadRuntime> {
  const cwd = cwdOverride ?? sessionManager.getCwd() ?? process.cwd();
  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    sessionManager,
  });

  return {
    threadPath,
    session,
  };
}

export function getThreadViewState(runtime: AgentThreadRuntime): AgentThreadViewState {
  const { session } = runtime;

  return {
    threadPath: runtime.threadPath,
    messages: structuredClone(session.messages),
    streamMessage: session.state.streamMessage ? structuredClone(session.state.streamMessage) : null,
    ...getThreadMetaState(runtime),
  };
}

export function getThreadMetaState(runtime: AgentThreadRuntime): AgentThreadMetaState {
  const { session } = runtime;

  return {
    isStreaming: session.isStreaming,
    steeringQueue: [...session.getSteeringMessages()],
    followUpQueue: [...session.getFollowUpMessages()],
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
    model: toModelSummary(session),
    thinkingLevel: session.thinkingLevel,
    supportsThinking: session.supportsThinking(),
    availableThinkingLevels: session.getAvailableThinkingLevels(),
  };
}

export function listAvailableModels(): AvailableModelInfo[] {
  return modelRegistry.getAvailable().map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name ?? m.id,
    reasoning: m.reasoning,
  }));
}

export function getEnabledModels(): string[] {
  return settingsManager.getEnabledModels() ?? [];
}

export function setEnabledModels(patterns: string[]): void {
  settingsManager.setEnabledModels(patterns.length > 0 ? patterns : undefined);
}

export async function setThreadModel(
  runtime: AgentThreadRuntime,
  provider: string,
  modelId: string,
): Promise<AgentThreadMetaState> {
  const model = modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(`Model not found: ${provider}/${modelId}`);
  }
  await runtime.session.setModel(model);
  return getThreadMetaState(runtime);
}

export function setThreadThinkingLevel(runtime: AgentThreadRuntime, level: string): AgentThreadMetaState {
  runtime.session.setThinkingLevel(level as AgentThreadMetaState["thinkingLevel"]);
  return getThreadMetaState(runtime);
}

function toModelSummary(session: AgentSession): AgentThreadModelSummary | null {
  const model = session.model;

  if (!model) {
    return null;
  }

  return {
    provider: model.provider,
    id: model.id,
    name: model.name ?? model.id,
  };
}
