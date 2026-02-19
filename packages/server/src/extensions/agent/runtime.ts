import { existsSync } from "node:fs";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import type { AgentThreadModelSummary, AgentThreadViewState } from "./types";

export interface AgentThreadRuntime {
  threadPath: string;
  session: AgentSession;
}

const authStorage = new AuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
const runtimeByThreadPath = new Map<string, Promise<AgentThreadRuntime>>();

export async function getThreadRuntime(threadPath: string): Promise<AgentThreadRuntime> {
  const resolvedPath = resolveThreadPath(threadPath);
  let runtimePromise = runtimeByThreadPath.get(resolvedPath);

  if (!runtimePromise) {
    runtimePromise = createThreadRuntime(resolvedPath);
    runtimeByThreadPath.set(resolvedPath, runtimePromise);
  }

  try {
    return await runtimePromise;
  } catch (error) {
    runtimeByThreadPath.delete(resolvedPath);
    throw error;
  }
}

function resolveThreadPath(threadPath: string): string {
  const resolvedPath = path.resolve(threadPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Thread file does not exist: ${resolvedPath}`);
  }

  return resolvedPath;
}

async function createThreadRuntime(threadPath: string): Promise<AgentThreadRuntime> {
  const sessionManager = SessionManager.open(threadPath);
  const cwd = sessionManager.getCwd() || process.cwd();
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
    isStreaming: session.isStreaming,
    steeringQueue: [...session.getSteeringMessages()],
    followUpQueue: [...session.getFollowUpMessages()],
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
    model: toModelSummary(session),
    thinkingLevel: session.thinkingLevel,
  };
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
