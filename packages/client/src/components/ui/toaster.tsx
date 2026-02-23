import { useEffect, useState } from "react";
import { subscribeToToasts, type ToastEntry } from "@/lib/toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "./toast";

export function Toaster() {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);

  useEffect(() => {
    return subscribeToToasts((toast) => {
      setToasts((current) => [...current, toast]);
    });
  }, []);

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          duration={toast.duration ?? 5000}
          variant={toast.variant}
          onOpenChange={(open) => {
            if (!open) {
              setToasts((current) => current.filter((entry) => entry.id !== toast.id));
            }
          }}
        >
          <div className="grid gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
