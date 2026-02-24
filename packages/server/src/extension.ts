import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URI } from "vscode-uri";
import {
  attachPanel,
  detachPanel,
  getActiveWorkspaceCwd,
  onPanelClosed,
  registerExtensionCommand,
  state,
  unregisterExtensionCommand,
  updatePanel,
} from "./state";
import { get, keys, set } from "./storage";
import { createDisposable } from "./utils/disposable";
import { TypedEmitter } from "./utils/typed-emitter";

interface ExtensionsApi {
  readonly commands: CommandsApi;
  readonly window: WindowApi;
  readonly workspace: WorkspaceApi;
  readonly storage: StorageApi;
}

interface CommandsApi {
  registerCommand(
    command: string,
    callback: (...args: any[]) => any | Promise<any>,
    options?: { title?: string; defaultKeybinding?: KeybindingDefinition },
  ): Disposable;
}

type KeybindingDefinition = {
  key: string;
  scope?: "global" | "view.command-palette" | "view.tabs" | "files.editor";
};

interface WindowEvents extends Record<string, never> {}
interface WindowApi extends TypedEventEmitter<WindowEvents> {
  createReactPanel(viewType: string, module: string, title: string, icon?: string, iconColor?: string): PanelHandle;
}

interface PanelEvents extends Record<string, never> {}
interface PanelHandle extends TypedEventEmitter<PanelEvents>, Disposable {
  readonly id: string;
  readonly viewType: string;
  readonly module: string;
  readonly disposed: boolean;
  title: string;
  icon?: string;
  state: Record<string, unknown>;
  iconColor?: string;
  closeOverlayIcon?: string;
}

interface WorkspaceEvents extends Record<string, never> {}
interface WorkspaceApi extends TypedEventEmitter<WorkspaceEvents> {
  readonly cwd: string;
  openTextDocument(uri: URI | string): Promise<TextDocumentHandle>;
}

interface TextDocumentEvents extends Record<string, never> {}
export interface TextDocumentHandle extends TypedEventEmitter<TextDocumentEvents> {
  readonly uri: URI;
  readonly fileName: string;
  readonly languageId: string;
  readonly isDirty: boolean;
  getText(range?: Range): string;
  save(): Promise<boolean>;
}

export interface StorageApi {
  keys(): readonly string[];
  get<T>(key: string, defaultValue?: T): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
}

export interface EventsApi {
  emit<T = unknown>(name: string, payload: T): void;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Position {
  line: number;
  character: number;
}

export type ExtensionActivate<T> = () => T | (T & Disposable) | Promise<T> | Promise<T & Disposable>;

export interface ExtensionActivationOptions {
  extensionId: string;
  cwd: string;
}

export interface ExtensionModule {
  activate(options: ExtensionActivationOptions): Promise<Disposable | void>;
}

interface ExtensionRuntimeContext {
  readonly extensionId: string;
  readonly cwd: string;
  readonly api: ExtensionsApi;
}

const extensionContext = new AsyncLocalStorage<ExtensionRuntimeContext>();

interface TypedEventEmitter<Events extends Record<string, unknown> = Record<string, never>> {
  addEventListener<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
    options?: { once?: true },
  ): Disposable;
  removeEventListener<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): void;
}

// The proxy routes every property access through AsyncLocalStorage to guarantee that
// each extension sees its own scoped API instance even when multiple extensions run concurrently.
export const modern: ExtensionsApi = new Proxy({} as ExtensionsApi, {
  get(_target, key) {
    const ctx = extensionContext.getStore();
    if (!ctx) {
      throw new Error("Extension API cannot be accessed outside of an active extension context.");
    }
    const value = ctx.api[key as keyof ExtensionsApi];
    return typeof value === "function" ? (value as any).bind(ctx.api) : value;
  },
});

// Backward-compatible alias for existing extensions.
export const diffs = modern;

export function createExtension<T>(activate: ExtensionActivate<T>): {
  activate: (options: ExtensionActivationOptions) => Promise<T | (T & Disposable)>;
} {
  return {
    async activate(options: ExtensionActivationOptions): Promise<T | (T & Disposable)> {
      const { extensionId, cwd } = options;
      if (!extensionId) throw new Error("Extension activation requires a stable extensionId.");
      if (!cwd) throw new Error("Extension activation requires a cwd.");

      const api = createExtensionsApi({ extensionId, cwd });
      return extensionContext.run({ extensionId, cwd, api }, async () => {
        return await activate();
      });
    },
  };
}

export async function executeCommandForWorkspace<T>(cwd: string, command: string, ...args: unknown[]): Promise<T> {
  const entry = state.commands.value.get(command);
  if (!entry) {
    throw new Error(`Command "${command}" is not registered.`);
  }

  const resolvedCwd = path.resolve(cwd);
  const callback = entry.callbacksByWorkspace.get(resolvedCwd);
  if (!callback) {
    throw new Error(`Command "${command}" is not available for workspace "${resolvedCwd}".`);
  }

  const api = createExtensionsApi({
    extensionId: entry.extensionId,
    cwd: resolvedCwd,
  });

  return extensionContext.run({ extensionId: entry.extensionId, cwd: resolvedCwd, api }, async () => {
    return (await callback(...args)) as T;
  });
}

export async function executeCommand<T>(command: string, ...args: unknown[]): Promise<T> {
  const cwd = getActiveWorkspaceCwd();
  if (!cwd) {
    throw new Error(`Command "${command}" requires an active workspace.`);
  }

  return executeCommandForWorkspace<T>(cwd, command, ...args);
}

export function listRegisteredCommands(): readonly {
  readonly command: string;
  readonly extensionId: string;
  readonly title?: string;
  readonly defaultKeybinding?: KeybindingDefinition;
}[] {
  return Array.from(state.commands.value.values()).map((cmd) => ({
    command: cmd.command,
    extensionId: cmd.extensionId,
    title: cmd.title,
    defaultKeybinding: cmd.defaultKeybinding,
  }));
}

function createExtensionsApi(options: ExtensionActivationOptions): ExtensionsApi {
  const cwd = path.resolve(options.cwd);
  return {
    commands: new Commands(options.extensionId, cwd),
    window: new Window(cwd),
    workspace: new Workspace(cwd),
    storage: new Storage(options.extensionId, cwd),
  };
}

class Commands implements CommandsApi {
  constructor(
    private readonly extensionId: string,
    private readonly cwd: string,
  ) {}

  registerCommand(
    command: string,
    callback: (...args: unknown[]) => unknown | Promise<unknown>,
    options?: { title?: string; defaultKeybinding?: KeybindingDefinition },
  ): Disposable {
    if (!command?.trim()) {
      throw new Error("Command identifier must be a non-empty string.");
    }
    registerExtensionCommand({
      command,
      extensionId: this.extensionId,
      cwd: this.cwd,
      callback,
      title: options?.title,
      defaultKeybinding: options?.defaultKeybinding,
    });
    return createDisposable(() => {
      unregisterExtensionCommand(command, this.cwd);
    });
  }
}

class Window extends TypedEmitter<WindowEvents> implements WindowApi {
  #panels = new Map<string, Panel>();

  constructor(private readonly cwd: string) {
    super();
  }

  createReactPanel(viewType: string, module: string, title: string, icon?: string, iconColor?: string): PanelHandle {
    if (!viewType?.trim()) throw new Error("viewType is required");
    if (!module?.trim()) throw new Error("module is required");
    if (!title?.trim()) throw new Error("title is required");

    const panel = new Panel({
      id: randomUUID(),
      cwd: this.cwd,
      viewType,
      module,
      title,
      icon,
      iconColor,
      remove: (id) => this.#panels.delete(id),
    });

    this.#panels.set(panel.id, panel);
    return panel;
  }
}

class Panel extends TypedEmitter<PanelEvents> implements PanelHandle {
  readonly id: string;
  readonly viewType: string;
  readonly module: string;
  readonly #cwd: string;
  #title: string;
  #icon?: string;
  #state: Record<string, unknown> = {};
  #iconColor?: string;
  #closeOverlayIcon?: string;
  #disposed = false;
  #remove: (id: string) => void;
  #closeDisposable: Disposable;

  constructor(params: {
    id: string;
    cwd: string;
    viewType: string;
    module: string;
    title: string;
    icon?: string;
    iconColor?: string;
    remove: (id: string) => void;
  }) {
    super();
    this.id = params.id;
    this.#cwd = params.cwd;
    this.viewType = params.viewType;
    this.module = params.module;
    this.#title = params.title;
    this.#icon = params.icon;
    this.#iconColor = params.iconColor;
    this.#remove = params.remove;

    // Listen for external tab closure (e.g. user closing via the UI).
    this.#closeDisposable = onPanelClosed(this.id, () => {
      this.#disposed = true;
      this.#remove(this.id);
    });

    // Attach panel to workspace-scoped state
    attachPanel(this.#cwd, {
      id: this.id,
      viewType: this.viewType,
      module: this.module,
      title: this.#title,
      workspaceCwd: this.#cwd,
      icon: this.#icon,
      state: this.#state,
    });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get title(): string {
    return this.#title;
  }

  set title(value: string) {
    this.#title = value;
    this.#updateGlobalState();
  }

  get icon(): string | undefined {
    return this.#icon;
  }

  set icon(value: string | undefined) {
    this.#icon = value;
    this.#updateGlobalState();
  }

  get state(): Record<string, unknown> {
    return this.#state;
  }

  set state(value: Record<string, unknown>) {
    this.#state = value;
    this.#updateGlobalState();
  }

  get iconColor(): string | undefined {
    return this.#iconColor;
  }

  set iconColor(value: string | undefined) {
    this.#iconColor = value;
    this.#updateGlobalState();
  }

  get closeOverlayIcon(): string | undefined {
    return this.#closeOverlayIcon;
  }

  set closeOverlayIcon(value: string | undefined) {
    this.#closeOverlayIcon = value;
    this.#updateGlobalState();
  }

  #updateGlobalState(): void {
    if (this.#disposed) return;
    updatePanel(this.#cwd, {
      id: this.id,
      viewType: this.viewType,
      module: this.module,
      title: this.#title,
      workspaceCwd: this.#cwd,
      icon: this.#icon,
      state: this.#state,
      iconColor: this.#iconColor,
      closeOverlayIcon: this.#closeOverlayIcon,
    });
  }

  [Symbol.dispose](): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#closeDisposable[Symbol.dispose]();
    this.#remove(this.id);
    detachPanel(this.#cwd, this.id);
  }
}

class Workspace extends TypedEmitter<WorkspaceEvents> implements WorkspaceApi {
  constructor(public readonly cwd: string) {
    super();
  }

  async openTextDocument(uriOrPath: URI | string): Promise<TextDocumentHandle> {
    const uri = normalizeUri(uriOrPath, this.cwd);
    const content = await readFile(uri.fsPath, "utf8");
    return new TextDocument(uri, content);
  }
}

class TextDocument extends TypedEmitter<TextDocumentEvents> implements TextDocumentHandle {
  readonly uri: URI;
  readonly fileName: string;
  readonly languageId: string;
  #isDirty = false;
  #content: string;
  readonly #lineOffsets: number[];

  constructor(uri: URI, content: string) {
    super();
    this.uri = uri;
    this.fileName = uri.fsPath;
    this.#content = content;
    this.languageId = deriveLanguageId(uri.fsPath);
    this.#lineOffsets = computeLineOffsets(content);
  }

  get isDirty(): boolean {
    return this.#isDirty;
  }

  getText(range?: Range): string {
    if (!range) return this.#content;
    const start = offsetAt(range.start, this.#lineOffsets, this.#content.length);
    const end = offsetAt(range.end, this.#lineOffsets, this.#content.length);
    return this.#content.slice(start, end);
  }

  async save(): Promise<boolean> {
    await writeFile(this.fileName, this.#content, "utf8");
    this.#isDirty = false;
    return true;
  }
}

class Storage implements StorageApi {
  constructor(
    private readonly extensionId: string,
    private readonly cwd: string,
  ) {}

  keys() {
    return keys(`extension:${this.extensionId}`, this.cwd);
  }
  get<T>(key: string, defaultValue?: T) {
    return get<T>(`extension:${this.extensionId}`, this.cwd, key, defaultValue);
  }
  async set<T>(key: string, value: T): Promise<void> {
    return set(`extension:${this.extensionId}`, this.cwd, key, value);
  }
}

function normalizeUri(input: URI | string, cwd: string): URI {
  if (typeof input !== "string") {
    return input;
  }
  if (/^[a-zA-Z][\w+.-]*:/.test(input)) {
    return URI.parse(input);
  }
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input);
  return URI.file(absolute);
}

function deriveLanguageId(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, "");
  if (!ext) return "plaintext";
  if (ext === "tsx") return "typescriptreact";
  if (ext === "ts") return "typescript";
  if (ext === "js") return "javascript";
  if (ext === "jsx") return "javascriptreact";
  if (ext === "json") return "json";
  if (ext === "md") return "markdown";
  if (ext === "rs") return "rust";
  return ext;
}

function computeLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === "\n") {
      offsets.push(i + 1);
    } else if (char === "\r") {
      if (content[i + 1] === "\n") {
        offsets.push(i + 2);
        i += 1;
      } else {
        offsets.push(i + 1);
      }
    }
  }
  return offsets;
}

function offsetAt(position: Position, lineOffsets: number[], contentLength: number): number {
  const { line, character } = position;
  if (line <= 0) {
    return Math.max(0, character);
  }
  if (line >= lineOffsets.length) {
    return contentLength;
  }
  const lineOffset = lineOffsets[line] ?? contentLength;
  const nextLineOffset = line + 1 < lineOffsets.length ? lineOffsets[line + 1] : contentLength;
  const clampedCharacter = Math.max(0, Math.min(character, nextLineOffset - lineOffset));
  return lineOffset + clampedCharacter;
}
