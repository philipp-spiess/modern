import { client } from "./rpc";

export type ExtensionPanelProps<T = object> = {
  id?: string;
  state: T;
  workspaceCwd?: string;
};

export const commands = {
  async execute<T = unknown>(
    command: string,
    args?: unknown | unknown[],
    options?: { projectCwd?: string; workspaceCwd?: string },
  ): Promise<T> {
    const normalized = Array.isArray(args) ? args : args === undefined ? [] : [args];
    const { result } = await client.commands.run({
      command,
      args: normalized,
      projectCwd: options?.projectCwd,
      workspaceCwd: options?.workspaceCwd,
    });
    return result as T;
  },
};
