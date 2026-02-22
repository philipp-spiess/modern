import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ext = process.platform === "win32" ? ".exe" : "";

const rustInfo = execSync("rustc -vV");
const targetTriple = /host: (\S+)/g.exec(rustInfo as any)![1];
if (!targetTriple) {
  console.error("Failed to determine platform target triple");
}
fs.mkdirSync(path.join(__dirname, "../../../src-tauri/binaries"), {
  recursive: true,
});
fs.renameSync(
  path.join(__dirname, `../dist/server${ext}`),
  path.join(__dirname, `../../../src-tauri/binaries/server-${targetTriple}${ext}`),
);

// Copy pi-coding-agent package.json into a subdirectory so the compiled server
// binary can resolve it at runtime (it reads APP_NAME, VERSION, piConfig from it).
// PI_PACKAGE_DIR will point here; the library expects a "package.json" in that dir.
const piDir = path.join(__dirname, "../../../src-tauri/pi-agent");
fs.mkdirSync(piDir, { recursive: true });
fs.copyFileSync(
  path.join(__dirname, "../../..", "node_modules/@mariozechner/pi-coding-agent/package.json"),
  path.join(piDir, "package.json"),
);

// Copy the ripgrep binary so the compiled server can use it for file indexing.
// The server reads RG_PATH env var to locate it.
const rgSrc = path.join(__dirname, "../../..", "node_modules/@vscode/ripgrep/bin/rg" + ext);
const rgDest = path.join(__dirname, "../../../src-tauri/binaries/rg" + ext);
fs.copyFileSync(rgSrc, rgDest);
fs.chmodSync(rgDest, 0o755);
