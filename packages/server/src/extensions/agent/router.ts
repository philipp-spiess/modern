import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { os } from "@orpc/server";
import * as z from "zod";
import { listOpenWorkspaces } from "../../state";
import {
  createThreadRuntimeForWorkspace,
  getThreadMetaState,
  getThreadRuntime,
  getThreadViewState,
  getEnabledModels,
  listAvailableModels,
  setEnabledModels,
  setThreadModel,
  setThreadThinkingLevel,
} from "./runtime";
import { listThreadsForWorkspace, type WorkspaceThreads } from "./threads";
import type {
  AgentThreadAbortResult,
  AgentThreadDeliveryMode,
  AgentThreadMessageTail,
  AgentThreadMetaState,
  AgentThreadSendResult,
  AgentThreadWatchUpdate,
  AvailableModelInfo,
} from "./types";

const threadInputSchema = z.object({
  threadPath: z.string().min(1),
});

const threadSendInputSchema = z.object({
  threadPath: z.string().min(1),
  text: z.string().trim().min(1),
  delivery: z.enum(["auto", "steer", "followUp"]).optional(),
});

const threadCreateInputSchema = z.object({
  cwd: z.string().min(1),
});

export const createThread = os.input(threadCreateInputSchema).handler(async ({ input }) => {
  const runtime = await createThreadRuntimeForWorkspace(input.cwd);
  return { threadPath: runtime.threadPath };
});

export const listWorkspaceThreads = os
  .input(
    z
      .object({
        workspaces: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .optional(),
  )
  .handler(async ({ input }) => {
    const workspaces = dedupeWorkspaces(input?.workspaces);
    const targets = workspaces.length > 0 ? workspaces : listOpenWorkspaces();

    const entries = await Promise.all(
      targets.map(async (cwd) => {
        try {
          const threads = await listThreadsForWorkspace(cwd, input?.limit);
          return { cwd, threads } satisfies WorkspaceThreads;
        } catch (error) {
          console.error(`Failed to list pi threads for workspace "${cwd}":`, error);
          return { cwd, threads: [] } satisfies WorkspaceThreads;
        }
      }),
    );

    return { workspaces: entries };
  });

/** Event types where we include an authoritative message tail for reliable sync. */
const CHECKPOINT_EVENTS = new Set(["turn_end", "agent_end", "auto_compaction_end", "auto_retry_end"]);

export const watchThread = os.input(threadInputSchema).handler(async function* ({ input }) {
  const runtime = await getThreadRuntime(input.threadPath);
  const { session } = runtime;

  let seq = 1;
  const snapshotState = getThreadViewState(runtime);
  const snapshotMessageCount = snapshotState.messages.length;

  yield {
    kind: "snapshot",
    seq: seq++,
    state: snapshotState,
  } satisfies AgentThreadWatchUpdate;

  const updates: AgentThreadWatchUpdate[] = [];
  let resolve: (() => void) | null = null;

  const unsubscribe = session.subscribe((event) => {
    const isCheckpoint = CHECKPOINT_EVENTS.has(event.type);
    const isCompactionReset = event.type === "auto_compaction_end";

    let messageTail: AgentThreadMessageTail | undefined;
    if (isCheckpoint) {
      const allMessages = session.messages;
      const fromIndex = isCompactionReset ? 0 : snapshotMessageCount;
      messageTail = {
        fromIndex,
        messages: structuredClone(allMessages.slice(fromIndex)),
      };
    }

    const update: AgentThreadWatchUpdate = {
      kind: "event",
      seq: seq++,
      event,
      meta: getThreadMetaState(runtime),
    };

    if (messageTail) {
      update.messageTail = messageTail;
    }

    if (isCheckpoint) {
      update.streamMessage = session.state.streamMessage ? structuredClone(session.state.streamMessage) : null;
    }

    updates.push(update);

    if (!resolve) {
      return;
    }

    resolve();
    resolve = null;
  });

  try {
    while (true) {
      if (updates.length === 0) {
        await new Promise<void>((next) => {
          resolve = next;
        });
      }

      while (updates.length > 0) {
        const update = updates.shift();
        if (!update) {
          continue;
        }

        yield update;
      }
    }
  } finally {
    unsubscribe();
  }
});

export const sendThreadMessage = os.input(threadSendInputSchema).handler(async ({ input }) => {
  const runtime = await getThreadRuntime(input.threadPath);
  const { session } = runtime;

  let delivery: AgentThreadSendResult["delivery"] = "prompt";

  if (!session.isStreaming) {
    await session.prompt(input.text);
  } else {
    delivery = resolveStreamingDelivery(session, input.delivery);
    if (delivery === "steer") {
      await session.steer(input.text);
    } else {
      await session.followUp(input.text);
    }
  }

  return {
    delivery,
    meta: getThreadMetaState(runtime),
  } satisfies AgentThreadSendResult;
});

export const abortThread = os.input(threadInputSchema).handler(async ({ input }) => {
  const runtime = await getThreadRuntime(input.threadPath);

  await runtime.session.abort();
  const cleared = runtime.session.clearQueue();

  return {
    cleared,
    meta: getThreadMetaState(runtime),
  } satisfies AgentThreadAbortResult;
});

export const modelsList = os.handler(async () => {
  return { models: listAvailableModels() satisfies AvailableModelInfo[] };
});

export const threadSetModel = os
  .input(
    z.object({
      threadPath: z.string().min(1),
      provider: z.string().min(1),
      modelId: z.string().min(1),
    }),
  )
  .handler(async ({ input }) => {
    const runtime = await getThreadRuntime(input.threadPath);
    const meta = await setThreadModel(runtime, input.provider, input.modelId);
    return { meta } satisfies { meta: AgentThreadMetaState };
  });

export const threadSetThinkingLevel = os
  .input(
    z.object({
      threadPath: z.string().min(1),
      level: z.string().min(1),
    }),
  )
  .handler(async ({ input }) => {
    const runtime = await getThreadRuntime(input.threadPath);
    const meta = setThreadThinkingLevel(runtime, input.level);
    return { meta } satisfies { meta: AgentThreadMetaState };
  });

export const enabledModelsList = os.handler(async () => {
  return { patterns: getEnabledModels() };
});

export const enabledModelsSet = os.input(z.object({ patterns: z.array(z.string()) })).handler(async ({ input }) => {
  setEnabledModels(input.patterns);
  return { patterns: getEnabledModels() };
});

export const agentRouter = {
  threadCreate: createThread,
  threadsList: listWorkspaceThreads,
  threadWatch: watchThread,
  threadSend: sendThreadMessage,
  threadAbort: abortThread,
  modelsList,
  enabledModelsList,
  enabledModelsSet,
  threadSetModel,
  threadSetThinkingLevel,
};

function dedupeWorkspaces(workspaces?: readonly string[]): string[] {
  if (!workspaces?.length) {
    return [];
  }

  return [...new Set(workspaces.filter(Boolean))];
}

function resolveStreamingDelivery(
  session: AgentSession,
  requestedMode: AgentThreadDeliveryMode | undefined,
): "steer" | "followUp" {
  if (requestedMode === "steer" || requestedMode === "followUp") {
    return requestedMode;
  }

  if (session.steeringMode === "all") {
    return "steer";
  }

  if (session.getSteeringMessages().length === 0) {
    return "steer";
  }

  return "followUp";
}
