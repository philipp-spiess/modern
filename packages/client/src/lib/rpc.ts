import type { Client } from "@moderndev/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { WebSocket as ReconnectingWebSocket } from "partysocket";

interface ServerInfo {
  port: number;
  token: string;
}

// These are set during init() and available synchronously afterwards.
export let client: Client;
export let orpc: ReturnType<typeof createTanstackQueryUtils<Client>>;
export let cwd: string;

let currentPort: number;
let currentToken: string;
let websocket: ReconnectingWebSocket;
let cwdPromise: Promise<string>;

let reconnectQueued = false;
let reconnecting = false;

/**
 * Initialise the RPC layer. Must be called (and awaited) once before
 * mounting React so that `client`, `orpc` and `cwd` are available.
 */
export async function init() {
  const serverInfo = await waitForServerInfo();
  currentPort = serverInfo.port;
  currentToken = serverInfo.token;

  websocket = new ReconnectingWebSocket(() => getWebSocketUrl(currentPort), undefined, {
    minReconnectionDelay: 100,
    maxReconnectionDelay: 500,
    reconnectionDelayGrowFactor: 1,
    minUptime: 0,
    connectionTimeout: 2_000,
    startClosed: true,
  });

  const link = new RPCLink({
    websocket: websocket as unknown as Pick<WebSocket, "addEventListener" | "readyState" | "send">,
  });

  client = createORPCClient(link);
  orpc = createTanstackQueryUtils(client);

  cwdPromise = getWorkspaceCwd();
  cwd = await cwdPromise;

  try {
    await listen<ServerInfo>("server-info-changed", (event) => {
      const info = event.payload;
      if (!info || typeof info.port !== "number" || info.port <= 0 || typeof info.token !== "string") {
        return;
      }

      if (info.port === currentPort && info.token === currentToken) {
        return;
      }

      currentPort = info.port;
      currentToken = info.token;
      scheduleReconnect();
    });
  } catch (error) {
    console.error("Failed to subscribe to server info changes", error);
  }

  // Trigger the first connection explicitly.
  scheduleReconnect();
}

async function waitForServerInfo(): Promise<ServerInfo> {
  const maxAttempts = 200;
  const delayMs = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await invoke<ServerInfo>("get_server_info");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Timed out waiting for server info");
}

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

  // Try to get the current project from the server first
  // If server has a project open, use that; otherwise use initial cwd
  try {
    const serverProject = await client.project.current();
    if (serverProject?.cwd) {
      return; // Server already has a project open, no need to reopen
    }
  } catch {
    // Server might not be ready yet, fall through to open project
  }

  const cwdValue = await cwdPromise;
  await client.project.open({ cwd: cwdValue });
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
  return `ws://127.0.0.1:${port}/?token=${currentToken}`;
}

function enableAutoReconnect() {
  // @ts-ignore - private property
  (websocket as ReconnectingWebSocket & { _shouldReconnect?: boolean })._shouldReconnect = true;
}

function disableAutoReconnect() {
  // @ts-ignore - private property
  (websocket as ReconnectingWebSocket & { _shouldReconnect?: boolean })._shouldReconnect = false;
}

export function getCurrentPort() {
  return currentPort;
}
