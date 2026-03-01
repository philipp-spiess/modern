import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { Badge } from "@/components/ui/badge";
import { Download, LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function SidebarUpdaterBadge() {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "installing">("idle");
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [contentLength, setContentLength] = useState<number | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      return;
    }

    setUpdateStatus("checking");

    try {
      const update = await check();

      setPendingUpdate((previous) => {
        if (previous && previous !== update) {
          void previous.close().catch(() => {});
        }
        return update;
      });

      setUpdateStatus(update ? "available" : "idle");
      setDownloadedBytes(0);
      setContentLength(null);
    } catch (error) {
      console.error("Failed to check for updates", error);
      setUpdateStatus("idle");
    }
  }, []);

  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  useEffect(
    () => () => {
      if (pendingUpdate) {
        void pendingUpdate.close().catch(() => {});
      }
    },
    [pendingUpdate],
  );

  const onInstallUpdate = useCallback(async () => {
    if (!pendingUpdate || updateStatus === "installing") {
      return;
    }

    setUpdateStatus("installing");
    setDownloadedBytes(0);
    setContentLength(null);

    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            setContentLength(event.data.contentLength ?? null);
            break;
          case "Progress":
            setDownloadedBytes((current) => current + event.data.chunkLength);
            break;
          case "Finished":
            break;
        }
      });

      await pendingUpdate.close().catch(() => {});
      setPendingUpdate(null);
      await relaunch();
    } catch (error) {
      console.error("Failed to install update", error);
      setUpdateStatus("available");
    }
  }, [pendingUpdate, updateStatus]);

  const onUpdateButtonClick = useCallback(async () => {
    if (updateStatus === "checking" || updateStatus === "installing") {
      return;
    }

    if (pendingUpdate) {
      await onInstallUpdate();
      return;
    }

    await checkForUpdates();
  }, [checkForUpdates, onInstallUpdate, pendingUpdate, updateStatus]);

  const updateLabel = useMemo(() => {
    if (updateStatus === "checking") {
      return "Checking";
    }

    if (updateStatus === "installing") {
      if (!contentLength || contentLength <= 0) {
        return "Installing";
      }
      const progress = Math.max(1, Math.min(99, Math.floor((downloadedBytes / contentLength) * 100)));
      return `Installing ${progress}%`;
    }

    if (!pendingUpdate) {
      return "Check updates";
    }

    return `Update ${pendingUpdate.version}`;
  }, [contentLength, downloadedBytes, pendingUpdate, updateStatus]);

  return (
    <Badge asChild className="border border-blue-500/70 bg-blue-500/90 px-0 py-0 text-white hover:bg-blue-500">
      <button
        type="button"
        onClick={() => void onUpdateButtonClick()}
        disabled={updateStatus === "checking" || updateStatus === "installing"}
        aria-label={pendingUpdate ? `Install update ${pendingUpdate.version}` : "Check for updates"}
        className="inline-flex items-center gap-1.5 px-2 py-0.5"
      >
        {updateStatus === "checking" || updateStatus === "installing" ? (
          <LoaderCircle className="size-3 animate-spin" />
        ) : pendingUpdate ? (
          <Download className="size-3" />
        ) : (
          <RefreshCcw className="size-3" />
        )}
        <span>{updateLabel}</span>
      </button>
    </Badge>
  );
}
