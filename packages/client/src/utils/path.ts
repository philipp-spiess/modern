export function dirname(path: string) {
  return path.split("/").slice(0, -1).join("/") ?? path;
}

export function basename(path: string) {
  return path.split("/").pop() ?? "";
}
