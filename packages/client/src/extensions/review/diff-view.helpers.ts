export interface StatusFile {
  path: string;
  index: string;
  working_dir: string;
}

export type FileStageState = "staged" | "partial" | "unstaged";

export const hasStatus = (value: string) => value.trim() !== "";
export const hasRealChange = (value: string) => hasStatus(value) && value !== "?";
export const hasStagedChange = (file: StatusFile) => hasRealChange(file.index);
export const hasWorktreeChange = (file: StatusFile) => hasStatus(file.working_dir);

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/^a\//, "").replace(/^b\//, "");
}

export function getChangedPaths(files: readonly StatusFile[]): string[] {
  return files
    .filter((file) => hasStagedChange(file) || hasWorktreeChange(file))
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));
}

export function getFileStageState(file: StatusFile | undefined): FileStageState {
  if (!file) {
    return "unstaged";
  }

  const staged = hasStagedChange(file);
  const unstaged = hasRealChange(file.working_dir);

  if (staged && !unstaged) {
    return "staged";
  }

  if (staged && unstaged) {
    return "partial";
  }

  return "unstaged";
}

export function areSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
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
