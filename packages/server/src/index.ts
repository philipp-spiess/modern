import { onError, type RouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/bun-ws";
import { serve } from "bun";
import { router } from "./router";

export type Client = RouterClient<typeof router>;

let activeConnections = 0;
let shutdownTimer: Timer | undefined;

function scheduleShutdown() {
  clearTimeout(shutdownTimer);
  if (activeConnections === 0) {
    shutdownTimer = setTimeout(() => {
      console.log("no connections shutting down");
      server.stop(true);
    }, 60_000);
  }
}

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const server = serve({
  port: process.env.PORT ?? 0,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("Upgrade failed", { status: 500 });
  },
  websocket: {
    open() {
      activeConnections += 1;
      clearTimeout(shutdownTimer);
    },
    message(ws, message) {
      handler.message(ws, message, { context: {} });
    },
    close(ws) {
      handler.close(ws);
      activeConnections = Math.max(0, activeConnections - 1);
      scheduleShutdown();
    },
  },
});

console.log(JSON.stringify({ port: server.port }));

scheduleShutdown();
