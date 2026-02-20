import { createDisposable } from "./disposable";

export interface TypedEventEmitter<Events extends Record<string, unknown>> {
  addEventListener<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
    options?: { once?: true },
  ): Disposable;
  removeEventListener<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): void;
}

export class TypedEmitter<Events extends Record<string, unknown> = Record<string, never>>
  implements TypedEventEmitter<Events>
{
  #listeners = new Map<
    keyof Events,
    Set<{
      listener: (payload: Events[keyof Events]) => void;
      once?: boolean;
    }>
  >();

  addEventListener<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
    options?: { once?: true },
  ): Disposable {
    const bucket =
      (this.#listeners.get(event) as Set<{ listener: (payload: Events[K]) => void; once?: boolean }>) ?? new Set();
    bucket.add({ listener, once: options?.once });
    this.#listeners.set(event, bucket as Set<{ listener: (payload: Events[keyof Events]) => void; once?: boolean }>);
    return createDisposable(() => {
      this.removeEventListener(event, listener);
    });
  }

  removeEventListener<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): void {
    const bucket = this.#listeners.get(event);
    if (!bucket) return;
    for (const entry of Array.from(bucket)) {
      if (entry.listener === listener) {
        bucket.delete(entry);
      }
    }
    if (bucket.size === 0) {
      this.#listeners.delete(event);
    }
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const bucket = this.#listeners.get(event);
    if (!bucket) return;
    for (const entry of Array.from(bucket)) {
      entry.listener(payload);
      if (entry.once) bucket.delete(entry);
    }
    if (bucket.size === 0) {
      this.#listeners.delete(event);
    }
  }
}
