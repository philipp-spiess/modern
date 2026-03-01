import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Badge } from "@/components/ui/badge";
import { useCallback, useEffect, useState } from "react";

export default function SidebarUpdaterBadge() {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) {
      return;
    }

    try {
      const update = await check();

      setPendingUpdate((previous) => {
        if (previous && previous !== update) {
          void previous.close().catch(() => {});
        }
        return update;
      });
    } catch (error) {
      console.error("Failed to check for updates", error);
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
    if (!pendingUpdate || installing) {
      return;
    }

    setInstalling(true);

    try {
      await pendingUpdate.downloadAndInstall();
      await pendingUpdate.close().catch(() => {});
      setPendingUpdate(null);
      await relaunch();
    } catch (error) {
      console.error("Failed to install update", error);
      setInstalling(false);
    }
  }, [installing, pendingUpdate]);

  if (!pendingUpdate) {
    return null;
  }

  return (
    <Badge asChild className="border-[#6394bf80] bg-[#6394bf1f] px-0 py-0 text-[#6394bf] hover:bg-[#6394bf2f]">
      <button
        type="button"
        onClick={() => void onInstallUpdate()}
        disabled={installing}
        aria-label={`Install update ${pendingUpdate.version}`}
        className="inline-flex items-center px-1.5 py-0 text-[10px] leading-4"
      >
        <span>Update available</span>
      </button>
    </Badge>
  );
}
