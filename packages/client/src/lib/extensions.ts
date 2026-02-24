import { client } from "./rpc";

export type ExtensionPanelProps<T = object> = {
  id?: string;
  state: T;
  workspaceCwd?: string;
};

export const commands = {
  async execute<T = unknown>(command: string, args?: unknown | unknown[], options?: { cwd?: string }): Promise<T> {
    const normalized = Array.isArray(args) ? args : args === undefined ? [] : [args];
    const { result } = await client.commands.run({ command, args: normalized, cwd: options?.cwd });
    return result as T;
  },
};
