import { createServer } from "node:net";

const DEFAULT_PORT = 1420;
const MAX_PORT_SCAN = 100;
const LOOPBACK_HOSTS = ["127.0.0.1", "::1"] as const;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

async function isPortAvailableOnHost(port: number, host: (typeof LOOPBACK_HOSTS)[number]): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL") {
        resolve(true);
        return;
      }

      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  for (const host of LOOPBACK_HOSTS) {
    if (!(await isPortAvailableOnHost(port, host))) {
      return false;
    }
  }

  return true;
}

async function findAvailablePort(startPort: number, excludePort?: number): Promise<number | null> {
  for (let port = startPort; port < startPort + MAX_PORT_SCAN; port += 1) {
    if (port === excludePort) {
      continue;
    }

    if (await isPortAvailable(port)) {
      return port;
    }
  }

  return null;
}

async function main() {
  const requestedDevPort = process.env.MODERN_DEV_PORT;
  const requestedHmrPort = process.env.MODERN_HMR_PORT;

  const devPort = requestedDevPort ? parsePort(requestedDevPort, DEFAULT_PORT) : await findAvailablePort(DEFAULT_PORT);

  if (devPort == null) {
    console.error(`Could not find a free dev port in range ${DEFAULT_PORT}-${DEFAULT_PORT + MAX_PORT_SCAN - 1}.`);
    process.exit(1);
  }

  if (requestedDevPort && !(await isPortAvailable(devPort))) {
    console.error(`Port ${devPort} is already in use. Pick another MODERN_DEV_PORT.`);
    process.exit(1);
  }

  const hmrPort = requestedHmrPort
    ? parsePort(requestedHmrPort, devPort + 1)
    : await findAvailablePort(devPort + 1, devPort);

  if (hmrPort == null) {
    console.error(`Could not find a free HMR port near ${devPort}. Set MODERN_HMR_PORT manually.`);
    process.exit(1);
  }

  if (requestedHmrPort && !(await isPortAvailable(hmrPort))) {
    console.error(`Port ${hmrPort} is already in use. Pick another MODERN_HMR_PORT.`);
    process.exit(1);
  }

  const config = JSON.stringify({
    build: {
      devUrl: `http://localhost:${devPort}`,
    },
  });

  if (devPort !== DEFAULT_PORT) {
    console.log(`Using dev port ${devPort} (HMR ${hmrPort}).`);
  }

  const child = Bun.spawn({
    cmd: ["tauri", "dev", "--config", config],
    env: {
      ...process.env,
      MODERN_DEV_PORT: String(devPort),
      MODERN_HMR_PORT: String(hmrPort),
    },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  process.exit(await child.exited);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
