import { os } from "@orpc/server";
import type { StatusResult } from "simple-git";
import * as z from "zod";
import { executeCommand, executeCommandForWorkspace, listRegisteredCommands } from "./extension";
import { agentRouter } from "./extensions/agent/router";
import { filesRouter } from "./extensions/files/router";
import { fileIndex } from "./file-index";
import { gitStatusSignal, showHead, showStaged, showWorktree, stage, unstage } from "./git";
import { discoverRecentRepos } from "./recent-repos";
import { settings, writeSettings } from "./settings";
import {
  closeTab,
  getActiveWorkspaceCwd,
  getWorkspaceActiveThread,
  getWorkspaceExpansionMap,
  getWorkspacePanels,
  getWorkspaceTabs,
  listOpenWorkspaces,
  openWorkspace,
  openWorkspaceWithThread,
  setWorkspaceExpanded,
  state,
  workspaceStateRevision,
} from "./state";

export const gitStage = os.input(z.object({ path: z.string() })).handler(({ input }) => stage(input.path));

export const gitUnstage = os.input(z.object({ path: z.string() })).handler(({ input }) => unstage(input.path));

export const gitShow = os
  .input(z.object({ action: z.enum(["head", "staged", "worktree"]), path: z.string() }))
  .handler(async ({ input }) => {
    switch (input.action) {
      case "head":
        return { content: await showHead(input.path) };
      case "staged":
        return { content: await showStaged(input.path) };
      case "worktree":
        return { content: await showWorktree(input.path) };
    }
  });

export const gitStatusWatch = os.handler(async function* (): AsyncGenerator<StatusResult | null> {
  // Subscribe BEFORE reading initial state to avoid race condition
  let resolve: ((value: void) => void) | null = null;
  const dispose = gitStatusSignal.subscribe(() => {
    resolve?.(undefined);
  });

  try {
    let lastRev = gitStatusSignal.value.rev;
    yield gitStatusSignal.value.status;

    while (true) {
      // Only wait if no change happened since last yield
      if (gitStatusSignal.value.rev === lastRev) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
      lastRev = gitStatusSignal.value.rev;
      yield gitStatusSignal.value.status;
    }
  } finally {
    dispose();
  }
});

export const filesQuickOpen = os
  .input(
    z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  )
  .handler(async ({ input }) => {
    const hits = await fileIndex.quickOpen({ ...input });
    return { hits };
  });

const resolveWorkspaceState = () => {
  const workspaces = listOpenWorkspaces();

  return {
    cwd: getActiveWorkspaceCwd(),
    workspaces,
    expandedByWorkspace: getWorkspaceExpansionMap(workspaces),
    activeThread: getWorkspaceActiveThread(),
  };
};

export const workspaceRecentRepos = os
  .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
  .handler(async ({ input }) => {
    const repos = await discoverRecentRepos(input?.limit ?? 20);
    return { repos };
  });

export const workspaceCwd = os.handler(() => {
  return resolveWorkspaceState();
});

export const workspaceOpen = os
  .input(
    z.object({
      cwd: z.string(),
    }),
  )
  .handler(async ({ input: { cwd } }) => {
    await openWorkspace(cwd);
    return resolveWorkspaceState();
  });

export const workspaceActivate = os
  .input(
    z.object({
      cwd: z.string(),
    }),
  )
  .handler(async ({ input: { cwd } }) => {
    await openWorkspace(cwd);
    return resolveWorkspaceState();
  });

export const workspaceSetExpanded = os
  .input(
    z.object({
      cwd: z.string(),
      expanded: z.boolean(),
    }),
  )
  .handler(async ({ input }) => {
    await setWorkspaceExpanded(input.cwd, input.expanded);
    return resolveWorkspaceState();
  });

export const workspaceOpenWithThread = os
  .input(
    z.object({
      cwd: z.string(),
      threadPath: z.string().min(1),
      title: z.string().optional(),
    }),
  )
  .handler(async ({ input }) => {
    await openWorkspaceWithThread(input.cwd, {
      kind: "existing",
      threadPath: input.threadPath,
      title: input.title,
    });
    return resolveWorkspaceState();
  });

export const workspaceOpenNewThread = os
  .input(
    z.object({
      cwd: z.string(),
      title: z.string().optional(),
    }),
  )
  .handler(async ({ input }) => {
    await openWorkspaceWithThread(input.cwd, {
      kind: "draft",
      title: input.title,
    });
    return resolveWorkspaceState();
  });

export const tabsClose = os
  .input(
    z.object({
      tabId: z.string(),
      cwd: z.string().optional(),
    }),
  )
  .handler(({ input }) => closeTab(input.tabId, input.cwd));

export const settingsSet = os
  .input(
    z.object({
      path: z.array(z.string()).min(1),
      value: z.unknown(),
    }),
  )
  .handler(async ({ input }) => {
    return writeSettings(input.path, input.value);
  });

export const settingsWatch = os.handler(async function* () {
  // Send initial state
  yield settings.value;

  // Subscribe to changes and stream updates
  let resolve: ((value: void) => void) | null = null;
  let pending = false;
  const dispose = settings.subscribe(() => {
    if (resolve) {
      resolve(undefined);
      resolve = null;
      return;
    }
    pending = true;
  });

  try {
    while (true) {
      if (!pending) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
      pending = false;
      yield settings.value;
    }
  } finally {
    dispose();
  }
});

export const tabsWatch = os
  .input(
    z
      .object({
        cwd: z.string().optional(),
      })
      .optional(),
  )
  .handler(async function* ({ input }) {
    const targetCwd = input?.cwd;

    // Send initial state
    yield getWorkspaceTabs(targetCwd);

    // Subscribe to changes and stream updates
    let resolve: ((value: void) => void) | null = null;
    let pending = false;
    const dispose = workspaceStateRevision.subscribe(() => {
      if (resolve) {
        resolve(undefined);
        resolve = null;
        return;
      }
      pending = true;
    });

    try {
      while (true) {
        if (!pending) {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
        pending = false;
        yield getWorkspaceTabs(targetCwd);
      }
    } finally {
      dispose();
    }
  });

export const commandsList = os.handler(async function* () {
  yield listRegisteredCommands();

  let resolve: ((value: void) => void) | null = null;
  let pending = false;
  const dispose = state.commands.subscribe(() => {
    if (resolve) {
      resolve(undefined);
      resolve = null;
      return;
    }
    pending = true;
  });

  try {
    while (true) {
      if (!pending) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
      pending = false;
      yield listRegisteredCommands();
    }
  } finally {
    dispose();
  }
});

export const commandsRun = os
  .input(
    z.object({
      command: z.string(),
      args: z.array(z.any()).optional(),
      cwd: z.string().optional(),
    }),
  )
  .handler(async ({ input }) => {
    const result = input.cwd
      ? await executeCommandForWorkspace(input.cwd, input.command, ...(input.args ?? []))
      : await executeCommand(input.command, ...(input.args ?? []));
    return { result };
  });

export const panelsState = os.handler(() => {
  const panels = state.panels.value;
  return Array.from(panels.values());
});

export const panelsWatch = os
  .input(
    z
      .object({
        cwd: z.string().optional(),
      })
      .optional(),
  )
  .handler(async function* ({ input }) {
    const targetCwd = input?.cwd;

    // Send initial state
    yield getWorkspacePanels(targetCwd);

    // Subscribe to changes and stream updates
    let resolve: ((value: void) => void) | null = null;
    let pending = false;
    const dispose = workspaceStateRevision.subscribe(() => {
      if (resolve) {
        resolve(undefined);
        resolve = null;
        return;
      }
      pending = true;
    });

    try {
      while (true) {
        if (!pending) {
          await new Promise<void>((r) => {
            resolve = r;
          });
        }
        pending = false;
        yield getWorkspacePanels(targetCwd);
      }
    } finally {
      dispose();
    }
  });

type AppRouter = {
  git: {
    statusWatch: typeof gitStatusWatch;
    stage: typeof gitStage;
    unstage: typeof gitUnstage;
    show: typeof gitShow;
  };
  settings: {
    set: typeof settingsSet;
    watch: typeof settingsWatch;
  };
  files: {
    quickOpen: typeof filesQuickOpen;
  } & typeof filesRouter;
  workspace: {
    cwd: typeof workspaceCwd;
    open: typeof workspaceOpen;
    activate: typeof workspaceActivate;
    setExpanded: typeof workspaceSetExpanded;
    openWithThread: typeof workspaceOpenWithThread;
    openNewThread: typeof workspaceOpenNewThread;
    recentRepos: typeof workspaceRecentRepos;
  };
  tabs: {
    watch: typeof tabsWatch;
    close: typeof tabsClose;
  };
  panels: {
    state: typeof panelsState;
    watch: typeof panelsWatch;
  };
  commands: {
    list: typeof commandsList;
    run: typeof commandsRun;
  };
  agent: typeof agentRouter;
};

export const router: AppRouter = {
  git: {
    statusWatch: gitStatusWatch,
    stage: gitStage,
    unstage: gitUnstage,
    show: gitShow,
  },
  settings: {
    set: settingsSet,
    watch: settingsWatch,
  },
  files: {
    quickOpen: filesQuickOpen,
    ...filesRouter,
  },
  workspace: {
    cwd: workspaceCwd,
    open: workspaceOpen,
    activate: workspaceActivate,
    setExpanded: workspaceSetExpanded,
    openWithThread: workspaceOpenWithThread,
    openNewThread: workspaceOpenNewThread,
    recentRepos: workspaceRecentRepos,
  },
  tabs: {
    watch: tabsWatch,
    close: tabsClose,
  },
  panels: {
    state: panelsState,
    watch: panelsWatch,
  },
  commands: {
    list: commandsList,
    run: commandsRun,
  },
  agent: agentRouter,
};
