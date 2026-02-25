import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { os } from "@orpc/server";
import * as z from "zod";
import {
  getProjectWorkspaceProvider,
  listOpenProjects,
  listProjectWorkspaceCwds,
  registerThreadWorkspace,
  releaseThreadWorkspace,
} from "../../state";
import {
  createThreadRuntimeForWorkspace,
  getThreadMetaState,
  getThreadRuntime,
  getThreadViewState,
  getDraftDefaultsForWorkspace,
  getEnabledModels,
  listAvailableModels,
  setEnabledModels,
  setThreadModel,
  setThreadThinkingLevel,
} from "./runtime";
import { archiveThreadForProject, listThreadsForWorkspace, type WorkspaceThreads } from "./threads";
import type {
  AgentDraftDefaults,
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
  projectCwd: z.string().min(1),
  workspaceProviderId: z.string().min(1).optional(),
});

const threadArchiveInputSchema = z.object({
  projectCwd: z.string().min(1),
  threadPath: z.string().min(1),
});

export const createThread = os.input(threadCreateInputSchema).handler(async ({ input }) => {
  let targetWorkspaceCwd = input.projectCwd;

  if (input.workspaceProviderId) {
    const provider = getProjectWorkspaceProvider(input.projectCwd, input.workspaceProviderId);
    if (!provider) {
      throw new Error(`Workspace provider not found: ${input.workspaceProviderId}`);
    }

    const handle = await provider.create({ cwd: input.projectCwd });
    targetWorkspaceCwd = handle.cwd;
  }

  const runtime = await createThreadRuntimeForWorkspace(targetWorkspaceCwd);
  registerThreadWorkspace(input.projectCwd, targetWorkspaceCwd, {
    providerId: input.workspaceProviderId,
    managed: Boolean(input.workspaceProviderId),
  });

  return { threadPath: runtime.threadPath, cwd: targetWorkspaceCwd };
});

export const archiveThread = os.input(threadArchiveInputSchema).handler(async ({ input }) => {
  const archived = await archiveThreadForProject(input.projectCwd, input.threadPath);
  await releaseThreadWorkspace(input.projectCwd, archived.previousCwd);
  return { threadPath: archived.threadPath };
});

export const listWorkspaceThreads = os
  .input(
    z
      .object({
        projects: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .optional(),
  )
  .handler(async ({ input }) => {
    const projects = dedupeProjects(input?.projects);
    const targets = projects.length > 0 ? projects : listOpenProjects();

    const entries = await Promise.all(
      targets.map(async (projectCwd) => {
        try {
          const workspaceCwds = listProjectWorkspaceCwds(projectCwd);
          const groups = await Promise.all(workspaceCwds.map((cwd) => listThreadsForWorkspace(cwd, input?.limit)));
          const merged = groups.flat().sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

          const seen = new Set<string>();
          const deduped = merged.filter((thread) => {
            if (seen.has(thread.path)) {
              return false;
            }
            seen.add(thread.path);
            return true;
          });

          const limited = deduped.slice(0, Math.max(input?.limit ?? 12, 0));

          return { cwd: projectCwd, threads: limited } satisfies WorkspaceThreads;
        } catch (error) {
          console.error(`Failed to list pi threads for project "${projectCwd}":`, error);
          return { cwd: projectCwd, threads: [] } satisfies WorkspaceThreads;
        }
      }),
    );

    return { projects: entries };
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

export const draftDefaults = os
  .input(
    z
      .object({
        projectCwd: z.string().min(1),
        provider: z.string().min(1).optional(),
        modelId: z.string().min(1).optional(),
      })
      .refine(
        (value) => {
          const hasProvider = Boolean(value.provider);
          const hasModelId = Boolean(value.modelId);
          return hasProvider === hasModelId;
        },
        {
          message: "provider and modelId must be provided together",
        },
      ),
  )
  .handler(async ({ input }) => {
    const defaults = await getDraftDefaultsForWorkspace(
      input.projectCwd,
      input.provider && input.modelId ? { provider: input.provider, modelId: input.modelId } : undefined,
    );
    return { defaults } satisfies { defaults: AgentDraftDefaults };
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
  threadArchive: archiveThread,
  threadsList: listWorkspaceThreads,
  threadWatch: watchThread,
  threadSend: sendThreadMessage,
  threadAbort: abortThread,
  modelsList,
  draftDefaults,
  enabledModelsList,
  enabledModelsSet,
  threadSetModel,
  threadSetThinkingLevel,
};

function dedupeProjects(projects?: readonly string[]): string[] {
  if (!projects?.length) {
    return [];
  }

  return [...new Set(projects.filter(Boolean))];
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
