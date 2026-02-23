import { ORPCError } from "@orpc/server";
import { type Signal, signal } from "@preact/signals-core";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import agentExtension, { id as agentExtensionId } from "./extensions/agent";
import filesExtension, { id as filesExtensionId } from "./extensions/files";
import reviewExtension, { id as reviewExtensionId } from "./extensions/review";
import terminalExtension, { id as terminalExtensionId } from "./extensions/terminal";
import viewExtension, { id as viewExtensionId } from "./extensions/view";
import { fileIndex } from "./file-index";
import { startGitWatcher } from "./git";
import { getGlobal, setGlobal, shutdownStorage } from "./storage";

export interface Panel {
  id: string;
  viewType: string;
  module: string;
  title: string;
  workspaceCwd?: string;
  icon?: string;
  iconColor?: string;
  closeOverlayIcon?: string;
  state: Record<string, unknown>;
}

export interface Tabs {
  groups: Array<{
    id: string;
    orientation: "vertical" | "horizontal";
    tabs: Array<{
      id: string;
      panelId: string;
    }>;
  }>;
}

type CommandCallback = (...args: unknown[]) => unknown | Promise<unknown>;

export type Command = {
  command: string;
  extensionId: string;
  title?: string;
  defaultKeybinding?: {
    key: string;
    scope?: "global" | "view.command-palette" | "view.tabs" | "files.editor";
  };
  callbacksByWorkspace: Map<string, CommandCallback>;
};

export type CommandRegistration = {
  command: string;
  extensionId: string;
  cwd: string;
  callback: CommandCallback;
  title?: string;
  defaultKeybinding?: {
    key: string;
    scope?: "global" | "view.command-palette" | "view.tabs" | "files.editor";
  };
};

export interface Workspaces {
  active: string | null;
  open: readonly string[];
}

export interface WorkspaceExistingThreadSelection {
  kind: "existing";
  threadPath: string;
  title?: string;
}

export interface WorkspaceDraftThreadSelection {
  kind: "draft";
  title?: string;
}

export type WorkspaceThreadSelection = WorkspaceExistingThreadSelection | WorkspaceDraftThreadSelection;

interface WorkspaceSession {
  cwd: string;
  tabs: Tabs;
  panels: Map<string, Panel>;
  activeThread: WorkspaceThreadSelection | null;
  activated: boolean;
  initializing?: Promise<void>;
  cleanup: () => Promise<void>;
}

const WORKSPACES_STORAGE_SCOPE = "core:workspace-registry";
const WORKSPACES_STORAGE_KEY = "open";
const WORKSPACE_SIDEBAR_STORAGE_SCOPE = "core:workspace-sidebar";
const WORKSPACE_SIDEBAR_COLLAPSED_KEY = "collapsed";

const workspaceSessions = new Map<string, WorkspaceSession>();

const extensionEntries = [
  { extension: viewExtension, id: viewExtensionId },
  { extension: agentExtension, id: agentExtensionId },
  { extension: filesExtension, id: filesExtensionId },
  { extension: reviewExtension, id: reviewExtensionId },
  { extension: terminalExtension, id: terminalExtensionId },
] as const;

function normalizeWorkspaceList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }

    const resolved = path.resolve(entry);
    if (seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);
    output.push(resolved);
  }

  return output;
}

function areSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function loadPersistedWorkspaces(): string[] {
  const stored = getGlobal<string[]>(WORKSPACES_STORAGE_SCOPE, WORKSPACES_STORAGE_KEY, []);
  return normalizeWorkspaceList(stored);
}

function loadPersistedCollapsedWorkspaces(): Set<string> {
  const stored = getGlobal<string[]>(WORKSPACE_SIDEBAR_STORAGE_SCOPE, WORKSPACE_SIDEBAR_COLLAPSED_KEY, []);
  return new Set(normalizeWorkspaceList(stored));
}

async function persistOpenWorkspaces(workspaces: readonly string[]): Promise<void> {
  await setGlobal(WORKSPACES_STORAGE_SCOPE, WORKSPACES_STORAGE_KEY, [...workspaces]);
}

async function persistCollapsedWorkspaces(collapsedWorkspaces: ReadonlySet<string>): Promise<void> {
  await setGlobal(
    WORKSPACE_SIDEBAR_STORAGE_SCOPE,
    WORKSPACE_SIDEBAR_COLLAPSED_KEY,
    [...collapsedWorkspaces].sort((a, b) => a.localeCompare(b)),
  );
}

const initialOpenWorkspaces = loadPersistedWorkspaces();
let collapsedWorkspaces = loadPersistedCollapsedWorkspaces();

export const state: {
  workspaces: Signal<Workspaces>;
  commands: Signal<Map<string, Command>>;
  panels: Signal<Map<string, Panel>>;
  tabs: Signal<Tabs>;
  activeThread: Signal<WorkspaceThreadSelection | null>;
} = {
  workspaces: signal<Workspaces>({ active: null, open: initialOpenWorkspaces }),
  commands: signal(new Map<string, Command>()),
  panels: signal(new Map<string, Panel>()),
  tabs: signal<Tabs>({ groups: [] }),
  activeThread: signal<WorkspaceThreadSelection | null>(null),
};

export const workspaceStateRevision = signal(0);

let openWorkspacePromise: Promise<void> | null = null;
let activeGitWatcher: Disposable | null = null;

export function getActiveWorkspaceCwd(): string | null {
  return state.workspaces.value.active;
}

export function listOpenWorkspaces(): readonly string[] {
  return state.workspaces.value.open;
}

export function getWorkspaceExpansionMap(
  workspaces: readonly string[] = listOpenWorkspaces(),
): Record<string, boolean> {
  const expandedByWorkspace: Record<string, boolean> = {};

  for (const cwd of workspaces) {
    const resolvedCwd = path.resolve(cwd);
    expandedByWorkspace[resolvedCwd] = !collapsedWorkspaces.has(resolvedCwd);
  }

  return expandedByWorkspace;
}

export async function setWorkspaceExpanded(cwd: string, expanded: boolean): Promise<void> {
  const resolvedCwd = path.resolve(cwd);
  const nextCollapsedWorkspaces = new Set(collapsedWorkspaces);

  if (expanded) {
    nextCollapsedWorkspaces.delete(resolvedCwd);
  } else {
    nextCollapsedWorkspaces.add(resolvedCwd);
  }

  if (areSetsEqual(nextCollapsedWorkspaces, collapsedWorkspaces)) {
    return;
  }

  await persistCollapsedWorkspaces(nextCollapsedWorkspaces);
  collapsedWorkspaces = nextCollapsedWorkspaces;
}

function withActiveWorkspace(cwd: string): Workspaces {
  const current = state.workspaces.value;
  if (current.active === cwd && current.open.includes(cwd)) {
    return current;
  }

  const open = current.open.includes(cwd) ? current.open : [...current.open, cwd];
  return {
    active: cwd,
    open,
  };
}

function getOrCreateWorkspaceSession(cwd: string): WorkspaceSession {
  const resolvedCwd = path.resolve(cwd);
  let session = workspaceSessions.get(resolvedCwd);
  if (session) {
    return session;
  }

  session = {
    cwd: resolvedCwd,
    tabs: { groups: [] },
    panels: new Map(),
    activeThread: null,
    activated: false,
    cleanup: async () => {},
  };
  workspaceSessions.set(resolvedCwd, session);
  return session;
}

async function activateWorkspaceSession(session: WorkspaceSession): Promise<void> {
  if (session.activated) {
    return;
  }

  if (session.initializing) {
    await session.initializing;
    return;
  }

  session.initializing = (async () => {
    const disposables: Disposable[] = [];

    disposables.push(
      ...(await Promise.all(
        extensionEntries.map((entry) => entry.extension.activate({ extensionId: entry.id, cwd: session.cwd })),
      )),
    );

    session.cleanup = async () => {
      for (const disposable of disposables) {
        await disposable[Symbol.dispose]();
      }
    };

    session.activated = true;
  })();

  try {
    await session.initializing;
  } finally {
    session.initializing = undefined;
  }
}

function cloneTabs(tabs: Tabs): Tabs {
  return {
    groups: tabs.groups.map((group) => ({
      ...group,
      tabs: group.tabs.map((tab) => ({ ...tab })),
    })),
  };
}

function clonePanel(panel: Panel): Panel {
  return {
    ...panel,
    state: structuredClone(panel.state),
  };
}

function cloneWorkspaceThreadSelection(thread: WorkspaceThreadSelection | null): WorkspaceThreadSelection | null {
  return thread ? { ...thread } : null;
}

function bumpWorkspaceStateRevision(): void {
  workspaceStateRevision.value += 1;
}

function resolveWorkspaceCwd(cwd?: string): string | null {
  if (cwd && cwd.trim()) {
    return path.resolve(cwd);
  }
  return getActiveWorkspaceCwd();
}

async function assertGitWorkspace(cwd: string): Promise<void> {
  try {
    await stat(path.join(cwd, ".git"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ORPCError("BAD_REQUEST", {
        message: `Workspace "${cwd}" is not a git repository (.git is missing).`,
      });
    }

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `Failed to verify git repository for workspace "${cwd}".`,
      cause: error,
    });
  }
}

function normalizeThreadSelection(cwd: string, input: WorkspaceThreadSelection): WorkspaceThreadSelection {
  const title = input.title?.trim();

  if (input.kind === "draft") {
    return {
      kind: "draft",
      ...(title ? { title } : {}),
    };
  }

  const threadPath = input.threadPath?.trim();
  if (!threadPath) {
    throw new Error("threadPath is required.");
  }

  return {
    kind: "existing",
    threadPath: path.resolve(cwd, threadPath),
    ...(title ? { title } : {}),
  };
}

export function getWorkspaceTabs(cwd?: string): Tabs {
  const resolvedCwd = resolveWorkspaceCwd(cwd);
  if (!resolvedCwd) {
    return { groups: [] };
  }

  const session = workspaceSessions.get(resolvedCwd);
  return session ? cloneTabs(session.tabs) : { groups: [] };
}

export function getWorkspacePanels(cwd?: string): readonly Panel[] {
  const resolvedCwd = resolveWorkspaceCwd(cwd);
  if (!resolvedCwd) {
    return [];
  }

  const session = workspaceSessions.get(resolvedCwd);
  if (!session) {
    return [];
  }

  return Array.from(session.panels.values(), clonePanel);
}

export function getWorkspaceActiveThread(cwd?: string): WorkspaceThreadSelection | null {
  const resolvedCwd = resolveWorkspaceCwd(cwd);
  if (!resolvedCwd) {
    return null;
  }

  const session = workspaceSessions.get(resolvedCwd);
  return cloneWorkspaceThreadSelection(session?.activeThread ?? null);
}

export function setWorkspaceActiveThread(
  cwd: string,
  thread: WorkspaceThreadSelection | null,
): WorkspaceThreadSelection | null {
  const session = getOrCreateWorkspaceSession(cwd);
  session.activeThread = thread ? normalizeThreadSelection(session.cwd, thread) : null;

  if (getActiveWorkspaceCwd() === session.cwd) {
    syncActiveWorkspaceState();
  } else {
    bumpWorkspaceStateRevision();
  }

  return cloneWorkspaceThreadSelection(session.activeThread);
}

function syncActiveWorkspaceState(): void {
  const activeCwd = getActiveWorkspaceCwd();
  if (!activeCwd) {
    state.tabs.value = { groups: [] };
    state.panels.value = new Map();
    state.activeThread.value = null;
    bumpWorkspaceStateRevision();
    return;
  }

  const session = getOrCreateWorkspaceSession(activeCwd);
  state.tabs.value = cloneTabs(session.tabs);
  state.panels.value = new Map(session.panels);
  state.activeThread.value = cloneWorkspaceThreadSelection(session.activeThread);
  bumpWorkspaceStateRevision();
}

async function switchActiveGitWatcher(cwd: string): Promise<void> {
  if (activeGitWatcher) {
    await activeGitWatcher[Symbol.dispose]();
    activeGitWatcher = null;
  }

  activeGitWatcher = startGitWatcher(cwd);
}

export async function openWorkspace(cwd: string) {
  const resolvedCwd = path.resolve(cwd);

  // If an initialization is already running, wait for it to finish before deciding.
  if (openWorkspacePromise) {
    await openWorkspacePromise;
    if (getActiveWorkspaceCwd() === resolvedCwd) {
      return;
    }
  }

  // No-op when the requested workspace matches the already loaded one.
  if (getActiveWorkspaceCwd() === resolvedCwd) {
    return;
  }

  await assertGitWorkspace(resolvedCwd);

  openWorkspacePromise = (async () => {
    state.workspaces.value = withActiveWorkspace(resolvedCwd);
    try {
      await persistOpenWorkspaces(state.workspaces.value.open);
    } catch (error) {
      console.error("Failed to persist workspace registry:", error);
    }

    const session = getOrCreateWorkspaceSession(resolvedCwd);
    await activateWorkspaceSession(session);

    await switchActiveGitWatcher(resolvedCwd);

    syncActiveWorkspaceState();
    void fileIndex.prewarm(resolvedCwd);
  })();

  try {
    await openWorkspacePromise;
  } finally {
    openWorkspacePromise = null;
  }
}

export async function openWorkspaceWithThread(cwd: string, thread: WorkspaceThreadSelection): Promise<void> {
  await openWorkspace(cwd);
  setWorkspaceActiveThread(cwd, thread);
}

export function registerExtensionCommand(entry: CommandRegistration) {
  const commands = new Map(state.commands.value);
  const existing = commands.get(entry.command);
  const resolvedCwd = path.resolve(entry.cwd);

  if (!existing) {
    commands.set(entry.command, {
      command: entry.command,
      extensionId: entry.extensionId,
      title: entry.title,
      defaultKeybinding: entry.defaultKeybinding,
      callbacksByWorkspace: new Map([[resolvedCwd, entry.callback]]),
    });
    state.commands.value = commands;
    return;
  }

  if (existing.extensionId !== entry.extensionId) {
    throw new Error(`Command "${entry.command}" is already registered by "${existing.extensionId}".`);
  }

  const callbacksByWorkspace = new Map(existing.callbacksByWorkspace);
  callbacksByWorkspace.set(resolvedCwd, entry.callback);

  commands.set(entry.command, {
    ...existing,
    title: existing.title ?? entry.title,
    defaultKeybinding: existing.defaultKeybinding ?? entry.defaultKeybinding,
    callbacksByWorkspace,
  });

  state.commands.value = commands;
}

export function unregisterExtensionCommand(command: string, cwd: string) {
  const commands = new Map(state.commands.value);
  const existing = commands.get(command);
  if (!existing) {
    return;
  }

  const callbacksByWorkspace = new Map(existing.callbacksByWorkspace);
  callbacksByWorkspace.delete(path.resolve(cwd));

  if (callbacksByWorkspace.size === 0) {
    commands.delete(command);
  } else {
    commands.set(command, {
      ...existing,
      callbacksByWorkspace,
    });
  }

  state.commands.value = commands;
}

export function __resetStateForTests() {
  for (const session of workspaceSessions.values()) {
    void session.cleanup();
  }
  workspaceSessions.clear();

  if (activeGitWatcher) {
    void activeGitWatcher[Symbol.dispose]();
    activeGitWatcher = null;
  }

  openWorkspacePromise = null;
  workspaceStateRevision.value = 0;
  state.workspaces.value = { active: null, open: [] };
  state.commands.value = new Map();
  state.panels.value = new Map();
  state.tabs.value = { groups: [] };
  state.activeThread.value = null;
  collapsedWorkspaces = new Set();
  shutdownStorage();
}

function openTab(current: Tabs, panelId: string): Tabs {
  if (current.groups.length === 0) {
    return {
      groups: [
        {
          id: randomUUID(),
          orientation: "horizontal",
          tabs: [{ id: panelId, panelId }],
        },
      ],
    };
  }

  const firstGroup = current.groups[0];
  return {
    groups: [
      {
        ...firstGroup,
        tabs: [...firstGroup.tabs, { id: panelId, panelId }],
      },
      ...current.groups.slice(1),
    ],
  };
}

function closeTabInWorkspace(current: Tabs, tabId: string): Tabs {
  return {
    groups: current.groups
      .map((group) => ({
        ...group,
        tabs: group.tabs.filter((tab) => tab.id !== tabId),
      }))
      .filter((group) => group.tabs.length > 0),
  };
}

export function closeTab(tabId: string, cwd?: string): Tabs {
  const targetCwd = resolveWorkspaceCwd(cwd);
  if (!targetCwd) {
    return state.tabs.value;
  }

  const session = getOrCreateWorkspaceSession(targetCwd);
  session.tabs = closeTabInWorkspace(session.tabs, tabId);

  if (getActiveWorkspaceCwd() === session.cwd) {
    syncActiveWorkspaceState();
  } else {
    bumpWorkspaceStateRevision();
  }

  return getWorkspaceTabs(targetCwd);
}

export function updatePanel(cwd: string, panel: Panel): void {
  const session = getOrCreateWorkspaceSession(cwd);
  const panels = new Map(session.panels);
  panels.set(panel.id, panel);
  session.panels = panels;

  if (getActiveWorkspaceCwd() === session.cwd) {
    syncActiveWorkspaceState();
  } else {
    bumpWorkspaceStateRevision();
  }
}

export function attachPanel(cwd: string, panel: Panel): void {
  const session = getOrCreateWorkspaceSession(cwd);
  updatePanel(session.cwd, panel);
  session.tabs = openTab(session.tabs, panel.id);

  if (getActiveWorkspaceCwd() === session.cwd) {
    syncActiveWorkspaceState();
  } else {
    bumpWorkspaceStateRevision();
  }
}

export function detachPanel(cwd: string, panelId: string): void {
  const session = getOrCreateWorkspaceSession(cwd);
  const panels = new Map(session.panels);
  panels.delete(panelId);
  session.panels = panels;
  session.tabs = closeTabInWorkspace(session.tabs, panelId);

  if (getActiveWorkspaceCwd() === session.cwd) {
    syncActiveWorkspaceState();
  } else {
    bumpWorkspaceStateRevision();
  }
}
