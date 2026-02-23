export type ToastVariant = "default" | "error";

export interface ToastMessage {
  readonly title: string;
  readonly description?: string;
  readonly variant?: ToastVariant;
  readonly duration?: number;
}

export interface ToastEntry extends ToastMessage {
  readonly id: string;
  readonly variant: ToastVariant;
}

type ToastListener = (toast: ToastEntry) => void;

const listeners = new Set<ToastListener>();

let toastSequence = 0;

function nextToastId(): string {
  toastSequence += 1;
  return `toast-${Date.now()}-${toastSequence}`;
}

export function showToast(message: ToastMessage): void {
  const toast: ToastEntry = {
    ...message,
    id: nextToastId(),
    variant: message.variant ?? "default",
  };

  for (const listener of listeners) {
    listener(toast);
  }
}

export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
