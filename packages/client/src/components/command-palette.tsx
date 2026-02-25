import { invoke } from "@tauri-apps/api/core";
import { ElCommandList, ElCommandPalette, ElDialog, ElDialogPanel } from "@tailwindplus/elements/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeybinding } from "../lib/keybindings";
import { client, orpc } from "../lib/rpc";
import { requestFocusPanel } from "../lib/tab-focus";
import { openProject, openProjectWithNewThread } from "../lib/project";
import { basename, dirname } from "../utils/path";

type CommandPaletteProps = {
  cwd: string;
  onShowSplash?: () => void;
};

type RegisteredCommand = {
  command: string;
  extensionId: string;
  title?: string;
  defaultKeybinding?: { key: string; scope?: string };
};

export default function CommandPalette({ cwd, onShowSplash }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const commandPaletteRef = useRef<any | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isCommandMode = search.startsWith(">");
  const trimmed = (isCommandMode ? search.slice(1) : search).trim();

  const filesQuery = useQuery({
    ...orpc.files.quickOpen.queryOptions({
      queryKey: ["files", "quickOpen", cwd, trimmed],
      input: { query: trimmed, limit: 80 },
      context: { cache: true },
      placeholderData: keepPreviousData,
    }),
    enabled: !isCommandMode,
  });

  const hits = !isCommandMode ? (filesQuery.data?.hits ?? []) : [];

  const commandsQuery = useQuery(
    orpc.commands.list.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const registeredCommands = useMemo(
    () => (commandsQuery.data as readonly RegisteredCommand[]) ?? [],
    [commandsQuery.data],
  );
  const commandFilter = isCommandMode ? trimmed : "";
  const filteredCommands = useMemo(() => {
    if (!isCommandMode) return [];
    const commandsWithTitle = registeredCommands.filter((command) => command.title);
    if (!commandFilter) return commandsWithTitle;
    const normalized = commandFilter.toLowerCase();
    return commandsWithTitle.filter((command) => {
      const haystacks = [command.command, command.title ?? "", command.defaultKeybinding?.key ?? ""];
      return haystacks.some((value) => value.toLowerCase().includes(normalized));
    });
  }, [commandFilter, registeredCommands, isCommandMode]);

  const closePalette = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
    }
  }, []);

  const openPalette = useCallback((mode: "files" | "commands") => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    setSearch(mode === "commands" ? ">" : "");

    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      if (mode === "commands" && input) {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }
    });
  }, []);

  useKeybinding("view.command-palette", async (command) => {
    switch (command) {
      case "view.command-palette.open-files":
        openPalette("files");
        return;
      case "view.command-palette.open-commands":
        openPalette("commands");
        return;
    }
  });

  const handleRunCommand = useCallback(
    async (commandId: string) => {
      closePalette();
      if (commandId === "files.openWorkspace") {
        await openProject();
        return;
      }
      if (commandId === "project.newThread") {
        await openProjectWithNewThread(cwd);
        return;
      }
      if (commandId === "view.splash.open") {
        onShowSplash?.();
        return;
      }
      if (commandId === "view.toggleDevTools") {
        void invoke("toggle_devtools");
        return;
      }
      await client.commands.run({ command: commandId });
    },
    [closePalette, cwd, onShowSplash],
  );

  const handleOpenFile = useCallback(
    async (path: string) => {
      let absolutePath = cwd + "/" + path;
      closePalette();
      try {
        const { result } = await client.commands.run({ command: "files.open", args: [absolutePath] });
        const panelId = (result as any)?.panelId;
        if (panelId) {
          requestFocusPanel(panelId);
        }
      } catch (error) {
        console.error("Failed to open file", error);
      } finally {
        setSearch("");
      }
    },
    [closePalette, cwd],
  );

  useEffect(() => {
    function onReady() {
      if (!commandPaletteRef.current) return;
      commandPaletteRef.current.setFilterCallback(() => true);
    }

    if (customElements.get("el-command")) {
      onReady();
      return;
    }

    window.addEventListener("elements:ready", onReady);
    return () => window.removeEventListener("elements:ready", onReady);
  }, []);

  return (
    // @ts-ignore - custom element typings
    <ElDialog onclose={() => setSearch("")}>
      <dialog ref={dialogRef} id="command-palette" className="backdrop:bg-transparent">
        <div className="fixed inset-x-0 top-2 z-50 flex justify-center px-4 sm:px-8">
          <ElDialogPanel className="mx-20 w-full max-w-2xl overflow-hidden rounded-md inset-ring inset-ring-white/10 bg-neutral-900/80 backdrop-blur-md shadow-lg inset-shadow-sm inset-shadow-white/5 shadow-black/30">
            <ElCommandPalette ref={commandPaletteRef} className="pb-3">
              <div className="px-3">
                <input
                  ref={inputRef}
                  type="text"
                  autoFocus
                  placeholder="Type a command or search…"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  inputMode="none"
                  spellCheck={false}
                  className="h-9 w-full bg-transparent text-sm text-neutral-100 placeholder:text-neutral-400 outline-none [ime-mode:disabled]"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>

              <ElCommandList className="max-h-[min(calc(100vh-56px),--spacing(140))] overflow-y-auto pb-1.5 flex flex-col">
                {isCommandMode ? (
                  filteredCommands.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-neutral-400">
                      {commandFilter.length > 0 ? `No commands matched “${commandFilter}”.` : "No commands available."}
                    </div>
                  ) : (
                    filteredCommands.map((command) => (
                      <button
                        key={command.command}
                        type="button"
                        className="group w-full px-1.5 py-0.25 text-sm text-neutral-200 text-left outline-hidden focus:outline-hidden"
                        onClick={() => void handleRunCommand(command.command)}
                      >
                        <div className="group-hover:bg-neutral-800/70 flex w-full items-center justify-between gap-2 px-1.5 py-0.75 rounded-lg group-aria-selected:bg-neutral-800/70 group-aria-selected:text-neutral-100">
                          <div className="flex min-w-0 flex-col">
                            <span className="font-medium text-neutral-100">{command.title ?? command.command}</span>
                          </div>
                          {command.defaultKeybinding ? (
                            <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.25 text-[10px] uppercase tracking-wide text-white/70">
                              {command.defaultKeybinding.key}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))
                  )
                ) : hits.length === 0 && trimmed.length > 0 ? (
                  <div className="px-2 py-1.5 text-xs text-neutral-400">No files matched “{trimmed}”.</div>
                ) : (
                  hits.map((hit) => (
                    <button
                      key={hit.path}
                      type="button"
                      className="group w-full px-1.5 py-0.25 text-sm text-neutral-200 text-left outline-hidden focus:outline-hidden"
                      onClick={() => void handleOpenFile(hit.path)}
                    >
                      <div className="group-hover:bg-neutral-800/70 flex w-full gap-1 items-center px-1.5 py-0.75 rounded-lg group-aria-selected:bg-neutral-800/70 group-aria-selected:text-neutral-100">
                        <span className="shrink-0 font-medium text-neutral-100">
                          <Highlighted text={basename(hit.path)} ranges={hit.basenameHighlights} />
                        </span>
                        <span className="truncate text-neutral-400">
                          <Highlighted text={dirname(hit.path)} ranges={hit.pathHighlights} />
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </ElCommandList>
            </ElCommandPalette>
          </ElDialogPanel>
        </div>
      </dialog>
    </ElDialog>
  );
}

function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (ranges.length === 0) {
    return text;
  }

  const segments: Array<{ value: string; highlighted: boolean }> = [];
  let cursor = 0;

  ranges.forEach(([start, end]) => {
    if (cursor < start) {
      segments.push({ value: text.slice(cursor, start), highlighted: false });
    }
    segments.push({ value: text.slice(start, end), highlighted: true });
    cursor = end;
  });

  if (cursor < text.length) {
    segments.push({ value: text.slice(cursor), highlighted: false });
  }

  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={`${segment.highlighted}-${index}`}>
          {segment.highlighted ? <span className="text-orange-300">{segment.value}</span> : segment.value}
        </Fragment>
      ))}
    </>
  );
}
