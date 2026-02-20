import { useSuspenseQuery } from "@tanstack/react-query";
import { GitBranch, Search } from "lucide-react";
import { orpc } from "../lib/rpc";
import { basename } from "../utils/path";
import CommandPalette from "./command-palette";

export default function Header({ cwd }: { cwd: string }) {
  const { data } = useSuspenseQuery(
    orpc.git.statusWatch.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  return (
    <header
      data-tauri-drag-region
      className="select-none grid gap-2 h-12 grid-cols-[1fr_minmax(100px,var(--container-md))_1fr] items-center"
    >
      <div data-tauri-drag-region className="pl-24 font-mono text-sm text-white/60">
        <span data-tauri-drag-region className="max-md:hidden flex items-center gap-1.5">
          <GitBranch data-tauri-drag-region className="size-3.5 text-white opacity-60" aria-hidden strokeWidth={1.5} />
          {data?.current}
        </span>
      </div>
      <div data-tauri-drag-region className="mx-auto flex size-full max-w-xl items-center justify-center">
        <button
          data-tauri-drag-region
          command="show-modal"
          commandfor="command-palette"
          type="button"
          className="bg-neutral-900/75 shadow in-aria-expanded:hidden  inset-shadow-sm inset-shadow-white/3 rounded-lg outline -outline-offset-1 outline-white/10 flex items-center justify-center w-full h-8"
        >
          <span
            data-tauri-drag-region
            className="text-sm flex gap-1 justify-center items-center text-shadow-md text-shadow-black/5 text-white/60 group-hover:text-white/70"
          >
            <Search data-tauri-drag-region className="size-3 text-white opacity-60" aria-hidden strokeWidth={1.5} />

            {basename(cwd)}
          </span>
        </button>

        <CommandPalette cwd={cwd} />
      </div>

      <div data-tauri-drag-region className="flex items-center justify-end pr-3"></div>
    </header>
  );
}
