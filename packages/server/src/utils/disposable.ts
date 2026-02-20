export function createDisposable(
  disposer: () => void | Disposable | Disposable[] | Promise<void | Disposable | Disposable[]>,
): Disposable {
  let disposed = false;
  return {
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;
      return runDisposer(disposer);
    },
  };
}

function runDisposer(
  disposer: () => void | Disposable | Disposable[] | Promise<void | Disposable | Disposable[]>,
): Promise<void> {
  return Promise.resolve(disposer()).then(async (result) => {
    await disposeValue(result);
  });
}

async function disposeValue(value: void | Disposable | Disposable[] | Promise<void | Disposable | Disposable[]>) {
  const resolved = await value;
  if (!resolved) return;
  if (Array.isArray(resolved)) {
    for (const entry of resolved) {
      await disposeValue(entry);
    }
    return;
  }
  if (typeof resolved[Symbol.dispose] === "function") {
    await resolved[Symbol.dispose]();
    return;
  }
  throw new Error("Unsupported disposable value.");
}
