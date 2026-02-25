import { invoke } from "@tauri-apps/api/core";
import { client } from "./rpc";

type ServerInfo = {
  port: number;
  token: string;
};

const SERVER_RESTART_TIMEOUT_MS = 20_000;
const SERVER_RESTART_POLL_INTERVAL_MS = 100;

let restartInFlight: Promise<void> | null = null;

export async function restartApp() {
  if (restartInFlight) {
    return restartInFlight;
  }

  restartInFlight = (async () => {
    const previousInfo = await getServerInfo();

    void client.commands.run({ command: "app.restart-server" }).catch((error) => {
      console.error("Failed to request app server restart", error);
    });

    const restarted = await waitForServerRestart(previousInfo);
    if (!restarted) {
      console.error("Timed out waiting for app server restart");
      return;
    }

    window.location.reload();
  })().finally(() => {
    restartInFlight = null;
  });

  return restartInFlight;
}

async function getServerInfo(): Promise<ServerInfo | null> {
  try {
    return await invoke<ServerInfo>("get_server_info");
  } catch {
    return null;
  }
}

async function waitForServerRestart(previousInfo: ServerInfo | null): Promise<boolean> {
  const deadline = Date.now() + SERVER_RESTART_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const nextInfo = await getServerInfo();

    if (nextInfo && isDifferentServerInfo(previousInfo, nextInfo)) {
      return true;
    }

    await delay(SERVER_RESTART_POLL_INTERVAL_MS);
  }

  return false;
}

function isDifferentServerInfo(previousInfo: ServerInfo | null, nextInfo: ServerInfo): boolean {
  if (!previousInfo) {
    return true;
  }

  return previousInfo.port !== nextInfo.port || previousInfo.token !== nextInfo.token;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
