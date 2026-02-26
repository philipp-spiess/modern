import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tauriBrowserProxy from "vite-plugin-tauri-in-the-browser";

const host = process.env.TAURI_DEV_HOST;

function resolvePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}

const devPort = resolvePort(process.env.MODERN_DEV_PORT, 1420);
const hmrPort = resolvePort(process.env.MODERN_HMR_PORT, devPort + 1);

// Tauri serves assets via tauri:// custom protocol which doesn't set CORS
// headers. Vite 7 hardcodes crossorigin on injected script/link tags, causing
// WKWebView to silently block them. This plugin strips the attribute.
function stripCrossorigin(): import("vite").Plugin {
  return {
    name: "strip-crossorigin",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, "");
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), tauriBrowserProxy() as any, stripCrossorigin()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
