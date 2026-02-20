import type { Client } from "@moderndev/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { WebSocket as ReconnectingWebSocket } from "partysocket";

async function waitForPort(): Promise<number> {
  const maxAttempts = 200;
  const delayMs = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await invoke<number>("get_server_port");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Timed out waiting for WebSocket RPC port");
}

const wsPort = await waitForPort();
let currentPort = wsPort;
const websocket = new ReconnectingWebSocket(() => getWebSocketUrl(currentPort), undefined, {
  minReconnectionDelay: 100,
  maxReconnectionDelay: 500,
  reconnectionDelayGrowFactor: 1,
  minUptime: 0,
  connectionTimeout: 2_000,
  startClosed: true,
});
const link = new RPCLink({ websocket });

export const client: Client = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

const cwdPromise = getWorkspaceCwd();
export const cwd = await cwdPromise;

let reconnectQueued = false;
let reconnecting = false;
const controlledSocket = websocket as ReconnectingWebSocket & { _shouldReconnect?: boolean };

try {
  await listen<number>("server-port-changed", (event) => {
    const nextPort = event.payload;
    if (typeof nextPort !== "number" || nextPort <= 0) {
      return;
    }

    if (nextPort === currentPort) {
      return;
    }

    currentPort = nextPort;
    scheduleReconnect();
  });
} catch (error) {
  console.error("Failed to subscribe to server port changes", error);
}

// Trigger the first connection explicitly.
scheduleReconnect();

async function getWorkspaceCwd(): Promise<string> {
  return invoke<string>("get_cwd");
}

export async function pickDirectory(): Promise<string | null> {
  return open({
    directory: true,
    multiple: false,
  });
}

function scheduleReconnect() {
  reconnectQueued = true;

  if (reconnecting) {
    return;
  }

  reconnecting = true;
  void (async () => {
    try {
      while (reconnectQueued) {
        reconnectQueued = false;
        await performReconnect();
      }
    } catch (error) {
      console.error("Failed to reconnect to oRPC server", error);
    } finally {
      reconnecting = false;
    }
  })();
}

async function performReconnect() {
  enableAutoReconnect();
  websocket.reconnect();
  try {
    await waitForSocketOpen(websocket);
  } finally {
    disableAutoReconnect();
  }

  // Try to get the current workspace from the server first
  // If server has a workspace open, use that; otherwise use initial cwd
  try {
    const serverCwd = await client.workspace.cwd();
    if (serverCwd?.cwd) {
      return; // Server already has a workspace open, no need to reopen
    }
  } catch {
    // Server might not be ready yet, fall through to open workspace
  }

  const cwdValue = await cwdPromise;
  await client.workspace.open({ cwd: cwdValue });
}

function waitForSocketOpen(socket: ReconnectingWebSocket): Promise<void> {
  if (socket.readyState === socket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handleOpen: EventListener = () => {
      socket.removeEventListener("open", handleOpen);
      resolve();
    };

    socket.addEventListener("open", handleOpen, { once: true });

    if (socket.readyState === socket.OPEN) {
      socket.removeEventListener("open", handleOpen);
      resolve();
    }
  });
}

function getWebSocketUrl(port: number) {
  return `ws://127.0.0.1:${port}/`;
}

function enableAutoReconnect() {
  // @ts-ignore - private property
  controlledSocket._shouldReconnect = true;
}

function disableAutoReconnect() {
  // @ts-ignore - private property
  controlledSocket._shouldReconnect = false;
}

export function getCurrentPort() {
  return currentPort;
}
